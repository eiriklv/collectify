var debug = require('debug')('collectify:main-app');
var hl = require('highland');
var _ = require('lodash');
var async = require('async');
var util = require('util');
var asyncify = require('asfy');
var EventEmitter = require('events').EventEmitter;
var mongoose = require('mongoose');
var helpers = require('./helpers');
var config = require('./config');
var setup = require('./setup');
var models = require('./models')(mongoose);
var InterprocessTransmitter = require('interprocess-push-stream').Transmitter;

/**
 * Test templates
 * if we need to
 * do some testing
 * without involving
 * mongoose/mongodb
 *
 * Contains one of each type
 * - feed (rss)
 * - json (api end-point)
 * - site (html)
 */
var templates = require('./templates');

/**
 * Create some curryed
 * helper functions to
 * 
 * - check if two objects are equal (primitives as well)
 * - pick properties from objects
 */
var isEqual = hl.ncurry(2, _.isEqual);
var pick = hl.ncurry(2, hl.flip(_.pick));

/**
 * Create instances of our
 * mapping functions.
 *
 * Here we are going to map from
 * templates to arrays of articles.
 */
var jsonMapper = require('json-mapper')({
  timeOut: 10000
});

var feedMapper = require('feed-mapper')({
  timeOut: 10000
});

var siteParser = require('site-parser')({
  timeOut: 10000
});

/**
 * Create streams for the channels
 * on which we want to
 * distribute / emit data.
 *
 * This uses the push-version
 * of the interface, but you
 * could also use the pull-version,
 * to enable load balancing
 * and back-pressure between
 * processes
 */
var updatedChannel = InterprocessTransmitter({
  channel: 'articles:updated',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

var newChannel = InterprocessTransmitter({
  channel: 'articles:new',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

var errorChannel = InterprocessTransmitter({
  channel: 'error',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

/**
 * Create a new event-emitter
 * which we are going to use
 * for errors
 *
 * We'll also make a curryed
 * version of eventEmitter.emit
 * that we'll use in our
 * application
 */
var eventEmitter = new EventEmitter();
var emit = hl.ncurry(2, eventEmitter.emit.bind(eventEmitter));

/**
 * Create an stream 
 * where we'll
 * collect all the
 * errors emitted
 * throughout the
 * the stream pipeline(s)
 */
var errorStream = hl('error', eventEmitter);

/**
 * Create a partially applied
 * bound function for fetching
 * data from the database.
 *
 * In this case templates/sources.
 */
var queryFunction = models.Source.find.bind(models.Source, {
  active: true
});

/**
 * Create a stream
 * from our query function above
 * - limit the rate to 1 fetch / 2 seconds
 * - do this only 10 times
 * - emit all errors via the event-emitter
 */
var realSource = hl(helpers.sourceWrapper(queryFunction));

/**
 * Create a stream from
 * our test templates
 * without accessing the
 * database
 */
var testSource = hl([templates]);

/**
 * Create a stream
 * from our source
 * of choice
 * - limit the rate to 1 fetch / 10 seconds
 * - emit all errors via the event-emitter
 */
var sourceStream = realSource
  .ratelimit(1, 10000)
  .compact()
  .flatten()

/**
 * Create a stream that
 * filters all the sources/templates,
 * selects only those of type 'json'.
 *
 * Map all of the templates
 * via the jsonMapper to
 * get a list of articles
 *
 * Process only 5 templates in parallel
 */
var jsonStream = sourceStream
  .fork()
  .filter(hl.compose(
    isEqual('json'),
    hl.get('type')
  ))
  .map(hl.wrapCallback(
    jsonMapper.parse.bind(jsonMapper)
  )).parallel(5)

/**
 * Create a stream that
 * filters all the sources/templates,
 * selects only those of type 'feed'.
 *
 * Map all of the templates
 * via the feedMapper to
 * get a list of articles
 *
 * Process only 5 templates in parallel
 */
var rssStream = sourceStream
  .fork()
  .filter(hl.compose(
    isEqual('feed'),
    hl.get('type')
  ))
  .map(hl.wrapCallback(
    feedMapper.parse.bind(feedMapper)
  )).parallel(5)


/**
 * Create a stream that
 * filters all the sources/templates,
 * selects only those of type 'site'.
 *
 * Map all of the templates
 * via the siteParser to
 * get a list of articles
 *
 * Process only 5 templates in parallel
 */
var siteStream = sourceStream
  .fork()
  .filter(hl.compose(
    isEqual('site'),
    hl.get('type')
  ))
  .map(hl.wrapCallback(
    siteParser.parse.bind(siteParser)
  )).parallel(5)

/**
 * Create a stream that merges
 * all the article streams
 * into a single stream.
 *
 * Flatten the input,
 * so that arrays of articles
 * are converted to a stream
 * of single articles
 *
 * Emit all errors via
 * the event-emitter
 */
var articleStream = hl([
    jsonStream,
    rssStream,
    siteStream
  ])
  .merge()
  .flatten()

/**
 * Create a stream that
 * filters the articleStream
 * and keeps only the articles
 * that does not already exist
 *
 * - In this case our predicate
 * is that if we get a count === 0
 * for the 'guid' we define it
 * as new
 */
var newArticleStream = articleStream
  .fork()
  .flatFilter(hl.wrapCallback(
    async.compose(
      asyncify(hl.not),
      asyncify(helpers.isTruthy),
      models.Entry.count.bind(models.Entry),
      asyncify(pick('guid'))
    )
  ))

/**
 * Create a stream that
 * filters the articleStream
 * and keeps only the articles
 * that already exist
 *
 * - In this case our predicate
 * is that if we get a count > 0
 * for the 'guid' we define it
 * as existing
 */
var existingArticleStream = articleStream
  .fork()
  .flatFilter(hl.wrapCallback(
    async.compose(
      asyncify(helpers.isTruthy),
      models.Entry.count.bind(models.Entry),
      asyncify(pick('guid'))
    )
  ))

/**
 * Create a stream that
 * forks the newArticleStream
 * and saves all the entries
 * in the database
 *
 * The result is the data
 * passed back from mongoose
 */
var savedArticleStream = newArticleStream
  .fork()
  .map(hl.wrapCallback(
    models.Entry.create.bind(models.Entry)
  )).parallel(10)

/**
 * Create a stream that
 * forks the existingArticleStream
 * and updates all the entries
 * in the database
 *
 * The result is the data
 * passed back from mongoose
 */
var updatedArticleStream = existingArticleStream
  .fork()
  .flatFilter(hl.wrapCallback(
    async.compose(
      asyncify(helpers.isTruthy),
      models.Entry.update.bind(models.Entry),
      helpers.formatForUpdate(['guid']),
      asyncify(hl.flip(hl.extend)({
        createdAt: Date.now()
      }))
    )
  ))

/**
 * Handle the errors from all
 * the stream in one single
 * handler
 */
var totalStream = hl([
    sourceStream,          //* redundant in our case
    jsonStream,            //* redundant in our case
    siteStream,            //* redundant in our case
    rssStream,             //* redundant in our case
    articleStream,         //* redundant in our case
    newArticleStream,      //* redundant in our case
    existingArticleStream, //* redundant in our case
    savedArticleStream,
    updatedArticleStream
  ])
  .merge()
  .observe()
  .errors(emit('error'))

/**
 * Connect to the database
 */
setup.connectToDatabase(
  mongoose,
  config.get('database.mongo.url')
);

/**
 * Log all the saved
 * articles and the
 * resulting entries in
 * mongodb
 */
savedArticleStream
  .fork()
  .map(helpers.inspect(debug, 'saved-stream'))
  .pipe(newChannel)

/**
 * Log all the updated
 * articles and the
 * resulting entries in
 * mongodb
 */
updatedArticleStream
  .fork()
  .map(helpers.inspect(debug, 'updated-stream'))
  .pipe(updatedChannel)

/**
 * Pipe all errors
 * to the error channel
 */
errorStream
  .map(helpers.inspect(debug, 'error-stream'))
  .pipe(errorChannel)

var debug = require('debug')('collectify:main-app');
var http = require('http');
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
var nodeRead = require('node-read');
var obtr = require('object-transform');

/**
 * Create an http agent
 * to set the max
 * amount of open sockets
 */
var httpAgent = new http.Agent();
httpAgent.maxSockets = 50;

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
 * Create some curryed
 * helper functions to
 *
 * - check if two objects are equal (primitives as well)
 * - pick properties from objects
 */
var wrap = hl.wrapCallback.bind(hl);
var isEqual = hl.ncurry(2, _.isEqual);
var pick = hl.ncurry(2, hl.flip(_.pick));
var has = hl.curry(hl.flip(_.has));
var transformTo = hl.curry(obtr.transformTo);
var transformToSync = hl.curry(obtr.transformToSync);
var copyFromTo = hl.curry(obtr.copy);
var copy = hl.compose(hl.flip(hl.extend)({}));
var getContentFromURL = hl.ncurry(3, _.rearg(nodeRead, 1, 0, 2));
var findOneEntry = hl.ncurry(4, _.rearg(models.Entry.findOne.bind(models.Entry), 2, 1, 0, 3));
var createEntry = models.Entry.create.bind(models.Entry);
var countEntries = models.Entry.count.bind(models.Entry);
var updateEntry = models.Entry.update.bind(models.Entry);
var findSources = hl.ncurry(4, _.rearg(models.Source.find.bind(models.Source), 2, 1, 0, 3));
var transformHTML = siteParser.parse.bind(siteParser);
var transformRSS = feedMapper.parse.bind(feedMapper);
var transformJSON = jsonMapper.parse.bind(jsonMapper);

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
 * Create a stream
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
var queryFunction = findSources({})('')({
  active: true
});

/**
 * Create a stream
 * with our query function
 * as the source
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
 * - limit the rate to 1 fetch / 30 seconds
 * - compact and flatten the stream
 * - limit the rate to 10 templates / 1 seconds
 * - emit all errors via the event-emitter
 */
var sourceStream = testSource
  .ratelimit(1, 30000)
  .compact()
  .flatten()
  .ratelimit(10, 1000)
  .errors(emit('error'))

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
  .map(wrap(transformJSON)).parallel(5)
  .errors(emit('error'))

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
  .map(wrap(transformRSS)).parallel(5)
  .errors(emit('error'))


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
  .map(wrap(transformHTML)).parallel(5)
  .errors(emit('error'))

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
  .errors(emit('error'))

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
  .flatFilter(wrap(
    async.compose(
      asyncify(hl.not),
      asyncify(helpers.isTruthy),
      countEntries,
      asyncify(pick('guid'))
    )
  ))
  .errors(emit('error'))

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
  .flatFilter(wrap(
    async.compose(
      asyncify(helpers.isTruthy),
      countEntries,
      asyncify(pick('guid'))
    )
  ))
  .errors(emit('error'))

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
  .map(wrap(createEntry)).parallel(100000)
  .invoke('toObject')
  .errors(emit('error'))

/**
 * Create a stream that
 * forks the existingArticleStream
 * and updates all the entries
 * in the database with a new timestamp
 *
 * The result is the data
 * passed back from mongoose
 */
var updatedArticleStream = existingArticleStream
  .fork()
  .map(copy)
  .map(hl.extend({
    createdAt: 0
  }))
  .map(transformToSync({
    createdAt: Date.now
  }))
  .flatFilter(wrap(
    async.compose(
      asyncify(helpers.isTruthy),
      updateEntry,
      helpers.formatForUpdate(['guid'])
    )
  ))
  .map(pick('guid'))
  .map(wrap(findOneEntry({}, ''))).parallel(100000)
  .invoke('toObject')
  .errors(emit('error'))

/**
 * Create a stream that
 * forks the updatedArticleStream
 * and updates all the entries
 * in the database with article / website content,
 * if it does not already have it
 *
 * The result is the data
 * passed back from mongoose
 */
var addedContentStream = updatedArticleStream
  .fork()
  .reject(has('content'))
  .map(copyFromTo({
    url: ['content']
  }))
  .map(wrap(
    transformTo({
      content: async.compose(
        asyncify(hl.get('content')),
        getContentFromURL({
          agent: httpAgent
        })
      )
    })
  )).parallel(50)
  .flatFilter(wrap(
    async.compose(
      asyncify(helpers.isTruthy),
      updateEntry,
      helpers.formatForUpdate(['guid'])
    )
  ))
  .map(pick('guid'))
  .map(wrap(findOneEntry({}, ''))).parallel(100000)
  .invoke('toObject')
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
  .doto(helpers.inspect(debug, 'saved-stream'))
  .pipe(newChannel)

/**
 * Log all the updated
 * articles and the
 * resulting entries in
 * mongodb
 */
updatedArticleStream
  .fork()
  .doto(helpers.inspect(debug, 'updated-stream'))
  .pipe(updatedChannel)

/**
 * Log all articles
 * updated with content
 */
addedContentStream
  .fork()
  .doto(helpers.inspect(debug, 'content-stream'))
  .resume()

/**
 * Pipe all errors
 * to the error channel
 */
errorStream
  .doto(helpers.inspect(debug, 'error-stream'))
  .pipe(errorChannel)
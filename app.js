var hl = require('highland');
var _ = require('lodash');
var async = require('async');
var asfy = require('asfy');
var EventEmitter = require('events').EventEmitter;
var mongoose = require('mongoose');
var helpers = require('./helpers');
var config = require('./config');
var setup = require('./setup');
var models = require('./models')(mongoose);
var InterprocessTransmitter = require('interprocess-push-stream').Transmitter;

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
var existingChannel = InterprocessTransmitter({
  channel: 'articles:existing',
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
 */
var eventEmitter = new EventEmitter();

/**
 * Create an stream for
 * all errors emitted
 * in the process
 */
var errorStream = _('error', eventEmitter);

/**
 * Create a curryed
 * helper function to
 * check if two objects
 * are equal (primitives as well)
 */
var isEqual = hl.ncurry(2, _.isEqual);

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
var sourceStream = hl(helpers.sourceWrapper(queryFunction))
  .ratelimit(1, 2000)
  .take(10)
  .errors(
    eventEmitter.emit.bind(
      eventEmitter,
      'error'
    )
  )
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
  .filter(
    hl.compose(
      isEqual('json'),
      hl.get('type')
    )
  )
  .map(
    hl.wrapCallback(
      jsonMapper.parse.bind(jsonMapper)
    )
  ).parallel(5)

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
  .filter(
    hl.compose(
      isEqual('rss'),
      hl.get('type')
    )
  )
  .map(
    hl.wrapCallback(
      feedMapper.parse.bind(feedMapper)
    )
  ).parallel(5)


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
  .filter(
    hl.compose(
      isEqual('site'),
      hl.get('type')
    )
  )
  .map(
    hl.wrapCallback(
      siteParser.parse.bind(siteParser)
    )
  ).parallel(5)

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
var articleStream = hl([jsonStream, rssStream, siteStream])
  .merge()
  .flatten()
  .errors(
    eventEmitter.emit.bind(
      eventEmitter,
      'error'
    )
  )

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
  .flatFilter(
    hl.wrapCallback(
      async.compose(
        asfy(hl.not),
        asfy(helpers.isTruthy),
        models.Entry.count,
        asfy(hl.get('guid'))
      )
    )
  )

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
  .flatFilter(
    hl.wrapCallback(
      async.compose(
        asfy(helpers.isTruthy),
        models.Entry.count,
        asfy(hl.get('guid'))
      )
    )
  )

/**
 * Connect to the database
 */
setup.connectToDatabase(
  mongoose,
  config.get('database.mongo.url')
);

/**
 * Pipe all new articles to
 * the channel defined
 * for new articles
 */
newArticleStream
  .pipe(newChannel)

/**
 * Pipe all new articles to
 * the channel defined
 * for existing articles
 */
existingArticleStream
  .pipe(existingChannel)

/**
 * Pipe all errors
 * to the error channel
 */
errorStream
  .pipe(errorChannel)

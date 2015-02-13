'use strict';

const debug = require('debug')('collectify:main-app');
const http = require('http');
const hl = require('highland');
const _ = require('lodash');
const async = require('async');
const util = require('util');
const asyncify = require('asfy');
const EventEmitter = require('events').EventEmitter;
const mongoose = require('mongoose');
const helpers = require('./helpers');
const config = require('./config');
const setup = require('./setup');
const models = require('./models')(mongoose);
const InterprocessPush = require('interprocess-push-stream');
const nodeRead = require('node-read');
const obtr = require('fp-object-transform');

/**
 * Create an http agent
 * to set the max
 * amount of open sockets
 */
const httpAgent = new http.Agent();
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
const templates = require('./templates');

/**
 * Create instances of our
 * mapping functions.
 *
 * Here we are going to map from
 * templates to arrays of articles.
 */
const jsonMapper = require('json-mapper')({
  timeOut: 10000
});

const feedMapper = require('feed-mapper')({
  timeOut: 10000
});

const siteParser = require('site-parser')({
  timeOut: 10000
});

/**
 * Create some curryed
 * helper functions
 * for convenience
 * and readability
 */
const wrap = hl.wrapCallback.bind(hl);
const isEqual = hl.ncurry(2, _.isEqual);
const pick = hl.ncurry(2, hl.flip(_.pick));
const has = hl.curry(hl.flip(_.has));
const transformTo = hl.curry(obtr.transformTo);
const transformToSync = hl.curry(obtr.transformToSync);
const copyToFrom = hl.curry(obtr.copyToFrom);
const copy = hl.compose(hl.flip(hl.extend)({}));
const clone = hl.compose(JSON.parse, JSON.stringify);
const getContentFromURL = hl.ncurry(3, _.rearg(nodeRead, 1, 0, 2));
const findOneEntry = hl.ncurry(4, _.rearg(models.Entry.findOne.bind(models.Entry), 2, 1, 0, 3));
const createEntry = models.Entry.create.bind(models.Entry);
const countEntries = models.Entry.count.bind(models.Entry);
const updateEntry = models.Entry.update.bind(models.Entry);
const findSources = hl.ncurry(4, _.rearg(models.Source.find.bind(models.Source), 2, 1, 0, 3));
const transformHTML = siteParser.parse.bind(siteParser);
const transformRSS = feedMapper.parse.bind(feedMapper);
const transformJSON = jsonMapper.parse.bind(jsonMapper);

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
const updatedChannel = InterprocessPush.Transmitter({
  channel: 'articles:updated',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

const newChannel = InterprocessPush.Transmitter({
  channel: 'articles:new',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

const errorChannel = InterprocessPush.Transmitter({
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
const eventEmitter = new EventEmitter();
const emit = hl.ncurry(2, eventEmitter.emit.bind(eventEmitter));

/**
 * Create a stream
 * where we'll
 * collect all the
 * errors emitted
 * throughout the
 * the stream pipeline(s)
 */
const errorStream = hl('error', eventEmitter);

/**
 * Create a partially applied
 * bound function for fetching
 * data from the database.
 *
 * In this case templates/sources.
 */
const queryFunction = findSources({})('')({
  active: true
});

/**
 * Create a stream
 * with our query function
 * as the source
 */
const realSource = hl(helpers.sourceWrapper(queryFunction));

/**
 * Create a stream from
 * our test templates
 * without accessing the
 * database
 */
const testSource = hl([templates]);

/**
 * Create a stream
 * from our source
 * of choice
 * - limit the rate to 1 fetch / 30 seconds
 * - compact and flatten the stream
 * - limit the rate to 10 templates / 1 seconds
 * - emit all errors via the event-emitter
 */
const sourceStream = realSource
  .ratelimit(1, 30000)
  .compact().flatten()
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
const jsonStream = sourceStream
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
const rssStream = sourceStream
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
const siteStream = sourceStream
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
const articleStream = hl([
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
const newArticleStream = articleStream
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
const existingArticleStream = articleStream
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
const savedArticleStream = newArticleStream
  .fork()
  .flatMap(wrap(createEntry))
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
const updatedArticleStream = existingArticleStream
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
  .flatMap(wrap(findOneEntry({}, '')))
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
const addedContentStream = updatedArticleStream
  .fork()
  .reject(has('content'))
  .map(copyToFrom({
    content: 'url'
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
  .flatMap(wrap(findOneEntry({}, '')))
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

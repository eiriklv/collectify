'use strict';

/**
 * Dependencies
 */
const debug = require('debug')('collectify:main-app');
const http = require('http');
const highland = require('highland');
const lodash = require('lodash-fp');
const async = require('async');
const util = require('util');
const asyncify = require('asfy');
const EventEmitter = require('events').EventEmitter;
const mongoose = require('mongoose');
const nodeRead = require('node-read');
const obtr = require('fp-object-transform');
const interprocess = require('interprocess-push-stream');

/**
 * Application-specific modules
 */
const helpers = require('./helpers');
const config = require('./config');
const setup = require('./setup');

/**
 * Data Models (mongoose)
 */
const Entries = require('./models/entry');
const Sources = require('./models/source');

/**
 * Create a custom http agent
 * and a corresponding
 * options object
 */
const httpAgent = new http.Agent();
httpAgent.maxSockets = 50;

const agentOpts = {
  agent: httpAgent
};

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
const updatedChannel = interprocess.Transmitter({
  channel: 'articles:updated',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

const createdChannel = interprocess.Transmitter({
  channel: 'articles:created',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

const errorChannel = interprocess.Transmitter({
  channel: 'errors',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

/**
 * Create instances of our
 * mappers/parsers.
 *
 * Here we are going to
 * 
 * - map from templates to arrays of articles
 * - map from url to social shares data
 */
const jsonMapper = require('json-mapper')({ timeOut: 10000 });
const feedMapper = require('feed-mapper')({ timeOut: 10000 });
const siteParser = require('site-parser')({ timeOut: 10000 });
const socialData = require('social-data')(agentOpts);

/**
 * Create some curryed
 * helper functions
 * for convenience
 * and readability
 */
const wrap = highland.wrapCallback.bind(highland);
const deriveTo = lodash.curry(obtr.deriveTo);
const deriveToSync = lodash.curry(obtr.deriveToSync);
const transformTo = lodash.curry(obtr.transformTo);
const transformToSync = lodash.curry(obtr.transformToSync);
const copyToFrom = lodash.curry(obtr.copyToFrom);
const copy = lodash.compose(highland.flip(highland.extend)({}));
const clone = lodash.compose(JSON.parse, JSON.stringify);
const getContentFromURL = lodash.curryN(3, lodash.rearg([1, 0, 2], nodeRead))(agentOpts);
const findOneEntry = lodash.curryN(4, lodash.rearg([2, 1, 0, 3], Entries.findOne.bind(Entries)));
const createEntry = Entries.create.bind(Entries);
const countEntries = Entries.count.bind(Entries);
const updateEntry = Entries.update.bind(Entries);
const formatEntryForUpdate = Entries.formatForUpdate.bind(Entries);
const findSources = lodash.curryN(4, lodash.rearg([2, 1, 0, 3], Sources.find.bind(Sources)));
const transformHTML = siteParser.parse.bind(siteParser);
const transformRSS = feedMapper.parse.bind(feedMapper);
const transformJSON = jsonMapper.parse.bind(jsonMapper);
const getKeywordsFromString = helpers.getKeywordsFromString;

/**
 * Function composition shorthands
 * for readability and reuse
 */
const isExisting = async.compose(
  asyncify(helpers.isTruthy),
  countEntries,
  asyncify(lodash.pick('guid'))
);

const isNotExisting = async.compose(
  asyncify(highland.not),
  isExisting
);

const addSocialDataFromUrl = deriveTo({
  shares: {
    facebook: ['url', socialData.facebook],
    twitter: ['url', socialData.twitter],
    linkedin: ['url', socialData.linkedin]
  }
});

const updateInDatabase = async.compose(
  asyncify(helpers.isTruthy),
  updateEntry,
  formatEntryForUpdate(['guid'])
);

const addContentFromUrl = deriveTo({
  content: ['url', async.compose(
    asyncify(lodash.result('content')),
    getContentFromURL
  )]
});

const addKeywordsFromContent = deriveToSync({
  keywords: ['content', getKeywordsFromString]
});

const updateTimestamp = deriveToSync({
  createdAt: [null, Date.now]
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
const emit = lodash.curryN(2, eventEmitter.emit.bind(eventEmitter));

/**
 * Create a stream
 * where we'll
 * collect all the
 * errors emitted
 * throughout the
 * the stream pipeline(s)
 */
const errorStream = highland('error', eventEmitter);

/**
 * Create a partially applied
 * bound function for fetching
 * data from the database
 * using mongoose.
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
const realSource = highland(helpers.sourceWrapper(queryFunction));

/**
 * Create a stream from
 * our test templates
 * without accessing the
 * database
 *
 * Contains one of each type
 * - feed (rss)
 * - json (api end-point)
 * - site (html)
 */
const testSource = highland([require('./templates')]);

/**
 * Create a stream
 * from our source
 * of choice
 * 
 * - limit the rate to 1 fetch / 30 seconds
 * - compact and flatten the stream
 * - limit the rate to 10 templates / 1 seconds
 * - emit all errors via the event-emitter
 */
const sourceStream = realSource
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
const jsonStream = sourceStream
  .fork()
  .filter(lodash.compose(
    lodash.isEqual('json'),
    lodash.result('type')
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
  .filter(lodash.compose(
    lodash.isEqual('feed'),
    lodash.result('type')
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
  .filter(lodash.compose(
    lodash.isEqual('site'),
    lodash.result('type')
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
const articleStream = highland([
    jsonStream,
    rssStream,
    siteStream
  ])
  .merge()
  .flatten()
  .compact()
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
 *
 * Save all the new entries
 * in the database
 *
 * The result is the data
 * passed back from mongoose
 */
const createdArticleStream = articleStream
  .fork()
  .flatFilter(wrap(isNotExisting))
  .flatMap(wrap(createEntry))
  .invoke('toObject')
  .errors(emit('error'))

/**
 * Create a stream that
 * filters the articleStream
 * and keeps only the articles
 * that already exist in the db
 *
 * - In this case our predicate
 * is that if we get a count > 0
 * for the 'guid' we define it
 * as existing
 *
 * We update all the existing
 * entries with
 *
 * - an updated timestamp
 * - social shares data
 *
 * The result is the data
 * passed back from mongoose
 */
const updatedArticleStream = articleStream
  .fork()
  .flatFilter(wrap(isExisting))
  .map(updateTimestamp)
  .map(wrap(addSocialDataFromUrl)).parallel(10)
  .flatFilter(wrap(updateInDatabase))
  .errors(emit('error'))

/**
 * Create a stream that
 * forks the updatedArticleStream
 * and updates all the entries
 * in the database with
 * 
 * - article / website content
 * - keywords based on the content
 * 
 * (if it does not have it already)
 *
 * The result is the data
 * passed back from mongoose
 * after updating
 */
const contentAddedStream = updatedArticleStream
  .fork()
  .map(lodash.pick('guid'))
  .flatMap(wrap(findOneEntry({}, '')))
  .invoke('toObject')
  .reject(lodash.has('content'))
  .map(wrap(addContentFromUrl)).parallel(10)
  .map(addKeywordsFromContent)
  .flatFilter(wrap(updateInDatabase))
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
 *
 * Pipe all updated articles
 * to the articles:created channel
 */
createdArticleStream
  .fork()
  .doto(helpers.inspect(debug, 'created-stream'))
  .pipe(createdChannel)

/**
 * Log all the updated
 * articles and the
 * resulting entries in
 * mongodb
 *
 * Pipe all updated articles
 * to the articles:updated channel
 */
updatedArticleStream
  .fork()
  .doto(helpers.inspect(debug, 'updated-stream'))
  .pipe(updatedChannel)

/**
 * Log all articles
 * updated with content
 */
contentAddedStream
  .fork()
  .doto(helpers.inspect(debug, 'content-added-stream'))
  .resume()

/**
 * Pipe all errors
 * to the error channel
 */
errorStream
  .doto(helpers.inspect(debug, 'error-stream'))
  .pipe(errorChannel)

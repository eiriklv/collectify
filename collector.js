'use strict';

/**
 * Dependencies
 */
const debug = require('debug')('collectify:main-app');
const http = require('http');
const hl = require('highland');
const _ = require('lodash-fp');
const async = require('async');
const util = require('util');
const asyncify = require('asfy');
const EventEmitter = require('events').EventEmitter;
const mongoose = require('mongoose');
const nodeRead = require('node-read');
const obtr = require('fp-object-transform');

/**
 * Application-specific modules
 */
const helpers = require('./helpers');
const config = require('./config');
const setup = require('./setup');

/**
 * Models
 */
const Entries = require('./models/entry');
const Sources = require('./models/source');

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
 * mappers/parsers.
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

const socialData = require('social-data')({
  agent: (new http.Agent())
});

/**
 * Create some curryed
 * helper functions
 * for convenience
 * and readability
 */
const wrap = hl.wrapCallback.bind(hl);
const deriveTo = _.curry(obtr.deriveTo);
const deriveToSync = _.curry(obtr.deriveToSync);
const transformTo = _.curry(obtr.transformTo);
const transformToSync = _.curry(obtr.transformToSync);
const copyToFrom = _.curry(obtr.copyToFrom);
const copy = _.compose(hl.flip(hl.extend)({}));
const clone = _.compose(JSON.parse, JSON.stringify);
const getContentFromURL = _.curryN(3, _.rearg([1, 0, 2], nodeRead));
const findOneEntry = _.curryN(4, _.rearg([2, 1, 0, 3], Entries.findOne.bind(Entries)));
const createEntry = Entries.create.bind(Entries);
const countEntries = Entries.count.bind(Entries);
const updateEntry = Entries.update.bind(Entries);
const formatEntryForUpdate = Entries.formatForUpdate.bind(Entries);
const findSources = _.curryN(4, _.rearg([2, 1, 0, 3], Sources.find.bind(Sources)));
const transformHTML = siteParser.parse.bind(siteParser);
const transformRSS = feedMapper.parse.bind(feedMapper);
const transformJSON = jsonMapper.parse.bind(jsonMapper);
const getKeywordsFromString = helpers.getKeywordsFromString;

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
const emit = _.curryN(2, eventEmitter.emit.bind(eventEmitter));

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
    _.isEqual('json'),
    _.result('type')
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
    _.isEqual('feed'),
    _.result('type')
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
    _.isEqual('site'),
    _.result('type')
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
      asyncify(_.pick('guid'))
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
      asyncify(_.pick('guid'))
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
 * in the database with
 * 
 * - an updated timestamp
 * - social shares data
 *
 * The result is the data
 * passed back from mongoose
 */
const updatedArticleStream = existingArticleStream
  .fork()
  .map(copy)
  .map(deriveToSync({
    createdAt: [null, Date.now]
  }))
  .map(wrap(
    deriveTo({
      shares: {
        facebook: ['url', socialData.facebook],
        twitter: ['url', socialData.twitter],
        linkedin: ['url', socialData.linkedin]
      }
    })
  )).parallel(10)
  .flatFilter(wrap(
    async.compose(
      asyncify(helpers.isTruthy),
      updateEntry,
      formatEntryForUpdate(['guid'])
    )
  ))
  .map(_.pick('guid'))
  .flatMap(wrap(findOneEntry({}, '')))
  .invoke('toObject')
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
const addedContentStream = updatedArticleStream
  .fork()
  .reject(_.has('content'))
  .map(wrap(
    deriveTo({
      content: ['url', async.compose(
        asyncify(_.result('content')),
        getContentFromURL({
          agent: httpAgent
        })
      )]
    })
  )).parallel(10)
  .map(deriveToSync({
    keywords: ['content', getKeywordsFromString]
  }))
  .flatFilter(wrap(
    async.compose(
      asyncify(helpers.isTruthy),
      updateEntry,
      formatEntryForUpdate(['guid'])
    )
  ))
  .map(_.pick('guid'))
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
 * Pipe all new articles to
 * the channel defined
 * for new articles
 */
newArticleStream
  .fork()
  .doto(helpers.inspect(debug, 'new-stream'))
  .resume()

/**
 * Pipe all new articles to
 * the channel defined
 * for existing articles
 */
existingArticleStream
  .fork()
  .doto(helpers.inspect(debug, 'existing-stream'))
  .resume()

/**
 * Log all the saved
 * articles and the
 * resulting entries in
 * mongodb
 */
savedArticleStream
  .fork()
  .doto(helpers.inspect(debug, 'saved-stream'))
  .resume()

/**
 * Log all the updated
 * articles and the
 * resulting entries in
 * mongodb
 */
updatedArticleStream
  .fork()
  .doto(helpers.inspect(debug, 'updated-stream'))
  .resume()

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
  .resume()

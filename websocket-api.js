'use strict';

/**
 * Dependencies
 */
const http = require('http');
const debug = require('debug')('collectify:main-app');
const highland = require('highland');
const lodash = require('lodash-fp');
const async = require('async');
const asyncify = require('asfy');
const EventEmitter = require('events').EventEmitter;
const InterprocessPush = require('interprocess-push-stream');
const obtr = require('fp-object-transform');
const websocket = require('websocket-stream')

/**
 * Application-specific modules
 */
const helpers = require('./helpers');
const config = require('./config');

/**
 * Create some curryed
 * helper functions
 * for convenience
 * and readability
 */
const wrap = highland.wrapCallback.bind(highland);
const transformTo = lodash.curry(obtr.transformTo);
const transformToSync = lodash.curry(obtr.transformToSync);
const copyToFrom = lodash.curry(obtr.copyToFrom);
const copy = highland.compose(highland.flip(highland.extend)({}));
const clone = highland.compose(JSON.parse, JSON.stringify);

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
const createdChannel = InterprocessPush.Receiver({
  channel: 'articles:created',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

const errorChannel = InterprocessPush.Transmitter({
  channel: 'errors',
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
 * Create a stream
 * with the newChannel
 * as the source
 */
const createdArticles = highland(createdChannel)
  .compact()
  .flatten()
  .errors(emit('error'))

/**
 * Log all the updated
 * articles and the
 * resulting entries in
 * mongodb
 */
createdArticles
  .fork()
  .doto(helpers.inspect(debug, 'publish-live'))
  .resume()

/**
 * Pipe all errors
 * to the error channel
 */
errorStream
  .doto(helpers.inspect(debug, 'error-stream'))
  .pipe(errorChannel)

/**
 * Create an http server
 * which we'll use to
 * attach a websocket server
 */
const server = http.createServer()

/**
 * Create a websocket server
 * where we 'plug' our content
 * stream into the websocket
 *
 * (We also kill the stream when the client ends)
 */
const wss = websocket.createServer({
  server: server
}, function(stream) {
  let contentStream = createdArticles
    .observe()
    .map(JSON.stringify)
    .doto(highland.log)
  
  contentStream.pipe(stream)

  stream.once('close', function() {
    contentStream.destroy();
  });
});

server.listen(3333);

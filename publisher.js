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
const InterprocessPush = require('interprocess-push-stream');
const obtr = require('fp-object-transform');

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
const newChannel = InterprocessPush.Receiver({
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
 * Create a stream
 * with the newChannel
 * as the source
 */
const newArticles = hl(newChannel)
  .compact()
  .flatten()
  .errors(emit('error'))

/**
 * Log all the updated
 * articles and the
 * resulting entries in
 * mongodb
 */
newArticles
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

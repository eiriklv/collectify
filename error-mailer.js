'use strict';

/**
 * Dependencies
 */
const debug = require('debug')('collectify:error-mailer');
const highland = require('highland');
const lodash = require('lodash-fp');
const interprocess = require('interprocess-push-stream');

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
const errorChannel = interprocess.Receiver({
  channel: 'errors',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

/**
 * Create a stream
 * with the errorChannel
 * as the source
 */
const errorMessageStream = highland(createdChannel)
  .compact()
  .flatten()
  .errors(function(err) {
    console.log(err);
  })

/**
 * Do stuff with the
 * stream of error messages
 */
errorMessageStream
  .fork()
  .each(highland.log)

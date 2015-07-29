/**
 * Dependencies
 */
const debug = require('debug')('collectify:error-processing');
const highland = require('highland');
const lodash = require('lodash-fp');
const interprocess = require('interprocess-push-stream');

/**
 * Application-specific modules
 */
const config = require('./config');

/**
 * Create some curryed
 * helper functions
 * for convenience
 * and readability
 */
const wrap = ::highland.wrapCallback;

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
  .errors((err) => {
    console.log(err);
  })

/**
 * Do stuff with the
 * stream of error messages
 *
 * - mail it to admin
 * - log it
 */
errorMessageStream
  .fork()
  .each(highland.log)

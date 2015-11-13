/**
 * Dependencies
 */
const debug = require('debug')('toppsaker-websocket-api:app');
const highland = require('highland');
const _ = require('lodash-fp');
const EventEmitter = require('events').EventEmitter;
const { Receiver } = require('interprocess-push-stream');
const app = require('express')();
const cors = require('cors');
const http = require('http').Server(app);
const io = require('socket.io')(http, { transports: ['websocket'] });

/**
 * Application-specific modules
 */
const config = require('./config');
const inspect = require('./helpers/inspect').bind(null, debug);

/**
 * Create streams for the channels
 * on which we want to
 * listen for data
 */
const newChannel = Receiver({
  channel: 'articles:new',
  prefix: config.get('database.redis.prefix'),
  url: config.get('database.redis.url')
});

const updateChannel = Receiver({
  channel: 'articles:update',
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
eventEmitter.setMaxListeners(1000);
const emit = _.curryN(2, eventEmitter.emit.bind(eventEmitter));

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
const newStream = highland(newChannel)
  .compact()
  .flatten()
  .errors(emit('error'))

/**
 * Create a stream
 * for monitoring
 * refreshes
 * (to force frontend updates on user)
 */
const updateStream = highland(updateChannel)
  .compact()
  .flatten()
  .errors(emit('error'))

/**
 * Log all the updated
 * articles and the
 * resulting entries in
 * mongodb
 */
newStream
  .fork()
  .doto(inspect('collectify-new'))
  .doto(emit('new'))
  .resume()

/**
 * Log all the updated
 * articles and the
 * resulting entries in
 * mongodb
 */
updateStream
  .fork()
  .doto(inspect('collectify-update'))
  .doto(emit('update'))
  .resume()

/**
 * Pipe all errors
 * to the error channel
 */
errorStream
  .doto(inspect('error-stream'))
  .resume()

/**
 * Create a route checking
 * the availability of the app
 */
app.get('/', (req, res) => {
  res.send('Websocket API up!');
});

/**
 * Create a socket.io server
 * where we broadcast the updates
 * to clients
 */
io.on('connection', (socket) => {
  debug('a user connected');

  /**
   * The list of subscriptions for the user
   * (in memory)
   */
  let subscriptionList = [];

  /**
   * Listen for client subscriptions
   * to specific sources
   */
  socket.on('subscribe', (subscriptions) => {
    if (Array.isArray(subscriptions)) {
      subscriptionList = subscriptions;
    }
  });

  /**
   * Create an event handler
   * for receiving updates
   * (named - so we can handle disconnects)
   */
  let newReceiver = (data) => {
    if (!_.contains(data._source, subscriptionList)) {
      return debug('got new article - but user is not subscribing to it');
    }

    debug('emitting new article', data);
    socket.emit('new', data);
  };

  /**
   * Create an event handler
   * for receiving updates
   * (named - so we can handle disconnects)
   */
  let updateReceiver = (data) => {
    if (!_.contains(data._source, subscriptionList)) {
      return debug('got updated article - but user is not subscribing to it');
    }

    debug('emitting updated article', data);
    socket.emit('update', data);
  };

  /**
   * Attach the event handlers
   * to events
   */
  eventEmitter.on('new', newReceiver);
  eventEmitter.on('update', updateReceiver)

  /**
   * Handle socket.io disconnect
   * and clean up
   */
  socket.on('disconnect', () => {
    debug('user disconnected');

    /**
     * Remove event listeners
     * (to avoid memory leaks)
     */
    eventEmitter.removeListener('new', newReceiver);
    eventEmitter.removeListener('update', updateReceiver);

    /**
     * Avoid potential memory leak
     * by 'nulling' out the array
     */
    subscriptionList = null;
  });
});

/**
 * Attach server to port
 */
http.listen(3002);

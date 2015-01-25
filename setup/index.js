var debug = require('debug')('collectify:setup');

module.exports.connectToDatabase = function(mongoose, url) {
  mongoose.connection.on('open', function(ref) {
    debug('open connection to mongo server.');
  });

  mongoose.connection.on('connected', function(ref) {
    debug('connected to mongo server.');
  });

  mongoose.connection.on('disconnected', function(ref) {
    debug('disconnected from mongo server.');
    debug('retrying connection in 2 seconds..');
    setTimeout(mongoose.connect.bind(mongoose, url), 2000);
  });

  mongoose.connection.on('close', function(ref) {
    debug('closed connection to mongo server');
  });

  mongoose.connection.on('error', function(err) {
    debug('error connection to mongo server!');
    debug(err);
  });

  mongoose.connection.on('reconnect', function(ref) {
    debug('reconnect to mongo server.');
  });

  mongoose.connect(url);
};

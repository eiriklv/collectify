var util = require('util');
var convict = require('convict');
var debug = require('debug')('collectify:config');

process.on('uncaughtException', function(err) {
  debug('Caught exception without specific handler: ' + util.inspect(err));
  debug(err.stack, 'error');
  process.exit(1);
});

var config = module.exports = convict({
  env: {
    doc: 'The application environment.',
    format: ['production', 'development'],
    default: 'development',
    env: 'NODE_ENV'
  },
  database: {
    mongo: {
      url: {
        doc: 'MongoDB url to connect to (including db reference)',
        default: 'mongodb://localhost/collectify',
        env: 'MONGO_URL'
      }
    }
  }
});

debug(util.inspect(process.env, {
  colors: true
}));

config.validate();

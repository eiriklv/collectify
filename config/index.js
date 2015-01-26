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
    },
    redis: {
      url: {
        doc: 'Redis url to connect to (including auth string)',
        default: 'redis://localhost:6379',
        env: 'REDIS_URL'
      },
      prefix: {
        doc: 'Redis prefix',
        default: '',
        env: 'REDIS_PREFIX'
      }
    }
  }
});

debug(util.inspect(process.env, {
  colors: true
}));

config.validate();

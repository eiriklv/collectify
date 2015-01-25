exports = module.exports = function(mongoose) {
  var entrySchema = new mongoose.Schema({
    guid: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    url: {
      type: String,
      required: true,
      index: true
    },
    ranking: {
      type: Number,
      required: true,
      index: true
    },
    source: {
      type: String,
      required: true,
      index: true
    },
    origin: {
      type: String,
      required: true
    },
    host: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true
    },
    image: {
      type: String
    },
    description: {
      type: String
    },
    content: mongoose.Schema.Types.Mixed,
    posted: {
      type: Date,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 86400, // ttl in seconds
      required: true
    }
  });

  entrySchema.set('toObject', {
    transform: function(doc, ret, options) {
      delete ret._id;
      delete ret.__v;
      // delete ret.createdAt; enable this if you do not want to update the expiry
    }
  });

  entrySchema.set('toJSON', {
    transform: function(doc, ret, options) {
      delete ret._id;
      delete ret.__v;
      // delete ret.createdAt; enable this if you do not want to update the expiry
    }
  });

  // create the model for articles and return it
  return mongoose.model('entry', entrySchema);
};

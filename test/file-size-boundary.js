/* eslint-env mocha */

var assert = require('assert')
var fs = require('fs')
var os = require('os')
var path = require('path')
var stream = require('stream')

var multer = require('../')
var rimraf = require('rimraf')

var BOUNDARY = 'sizeboundary7MA4YWxkTrZu0gW'
var FIELD = 'avatar'

function content (size) {
  var buf = Buffer.alloc(size)
  for (var i = 0; i < size; i++) buf[i] = i % 251
  return buf
}

function multipartBody (data) {
  return Buffer.concat([
    Buffer.from('--' + BOUNDARY + '\r\n' +
      'Content-Disposition: form-data; name="' + FIELD + '"; filename="data.bin"\r\n' +
      'Content-Type: application/octet-stream\r\n\r\n'),
    data,
    Buffer.from('\r\n--' + BOUNDARY + '--\r\n')
  ])
}

function writeBody (req, body, byteAtATime) {
  if (!byteAtATime) return req.end(body)

  var i = 0
  function next () {
    if (i === body.length) return req.end()
    req.write(body.slice(i, i + 1))
    i++
    setImmediate(next)
  }
  next()
}

// Sends one file through multer and passes (err, req, sent, dir) to assertions.
// opts: size, limit, disk, byteAtATime, limits. A disk upload gets a fresh
// temp folder that is removed once the assertions have run.
function upload (opts, assertions, done) {
  var sent = content(opts.size)
  var body = multipartBody(sent)
  var limits = opts.limits || { fileSize: opts.limit }
  var dir = null
  var options = { limits: limits }

  function finish (failure) {
    if (!dir) return done(failure)
    rimraf(dir, function (rmErr) {
      done(failure || rmErr)
    })
  }

  function start () {
    var req = new stream.PassThrough()
    req.headers = {
      'content-type': 'multipart/form-data; boundary=' + BOUNDARY,
      'content-length': String(body.length)
    }

    multer(options).single(FIELD)(req, null, function (err) {
      var failure = null
      try {
        assertions(err, req, sent, dir)
      } catch (e) {
        failure = e
      }
      finish(failure)
    })

    writeBody(req, body, opts.byteAtATime)
  }

  if (!opts.disk) return start()

  fs.mkdtemp(path.join(os.tmpdir(), 'multer-size-'), function (err, made) {
    if (err) return done(err)
    dir = made
    options.dest = made
    start()
  })
}

function assertAccepted (err, req, sent, disk) {
  assert.ifError(err)
  assert.ok(req.file, 'expected req.file to be set')
  assert.strictEqual(req.file.fieldname, FIELD)
  assert.strictEqual(req.file.size, sent.length)
  if (disk) {
    assert.ok(sent.equals(fs.readFileSync(req.file.path)), 'stored bytes differ from sent bytes')
  } else {
    assert.ok(Buffer.isBuffer(req.file.buffer))
    assert.ok(sent.equals(req.file.buffer), 'buffer differs from sent bytes')
  }
}

function assertTooLarge (err, req) {
  assert.ok(err, 'expected an error')
  assert.ok(err instanceof multer.MulterError)
  assert.strictEqual(err.code, 'LIMIT_FILE_SIZE')
  assert.strictEqual(err.message, 'File too large')
  assert.strictEqual(err.field, FIELD)
  assert.strictEqual(req.file, undefined)
}

describe('File size boundary', function () {
  var N = 16

  describe('memory storage', function () {
    it('accepts a file of exactly the limit', function (done) {
      upload({ size: N, limit: N }, function (err, req, sent) {
        assertAccepted(err, req, sent, false)
      }, done)
    })

    it('accepts a file one byte under the limit', function (done) {
      upload({ size: N - 1, limit: N }, function (err, req, sent) {
        assertAccepted(err, req, sent, false)
      }, done)
    })

    it('rejects a file one byte over the limit', function (done) {
      upload({ size: N + 1, limit: N }, function (err, req) {
        assertTooLarge(err, req)
      }, done)
    })
  })

  describe('disk storage', function () {
    it('accepts a file of exactly the limit', function (done) {
      upload({ size: N, limit: N, disk: true }, function (err, req, sent) {
        assertAccepted(err, req, sent, true)
      }, done)
    })

    it('accepts a file one byte under the limit', function (done) {
      upload({ size: N - 1, limit: N, disk: true }, function (err, req, sent) {
        assertAccepted(err, req, sent, true)
      }, done)
    })

    it('rejects a file one byte over the limit and keeps nothing', function (done) {
      upload({ size: N + 1, limit: N, disk: true }, function (err, req, sent, dir) {
        assertTooLarge(err, req)
        assert.deepStrictEqual(fs.readdirSync(dir), [])
      }, done)
    })
  })

  describe('body written one byte at a time', function () {
    it('accepts a file of exactly the limit', function (done) {
      upload({ size: N, limit: N, byteAtATime: true }, function (err, req, sent) {
        assertAccepted(err, req, sent, false)
      }, done)
    })

    it('rejects a file one byte over the limit', function (done) {
      upload({ size: N + 1, limit: N, byteAtATime: true }, function (err, req) {
        assertTooLarge(err, req)
      }, done)
    })
  })

  describe('limit of 5 MB', function () {
    var BIG = 5 * 1024 * 1024

    it('accepts a file of exactly 5 MB', function (done) {
      this.timeout(30000)
      upload({ size: BIG, limit: BIG }, function (err, req, sent) {
        assertAccepted(err, req, sent, false)
      }, done)
    })

    it('rejects a file one byte over 5 MB', function (done) {
      this.timeout(30000)
      upload({ size: BIG + 1, limit: BIG }, function (err, req) {
        assertTooLarge(err, req)
      }, done)
    })
  })

  describe('limits object', function () {
    it('is left unchanged after a request', function (done) {
      var limits = { fileSize: N }

      upload({ size: N - 1, limits: limits }, function (err, req, sent) {
        assertAccepted(err, req, sent, false)
        assert.strictEqual(limits.fileSize, N)
        assert.deepStrictEqual(limits, { fileSize: 16 })
      }, done)
    })
  })
})

/* eslint-env mocha */

var assert = require('assert')
var stream = require('stream')

var multer = require('../')

var BOUNDARY = 'inheritedlimits7MA4YWxkTrZu0gW'

function textPart (name, value) {
  return '--' + BOUNDARY + '\r\n' +
    'Content-Disposition: form-data; name="' + name + '"\r\n\r\n' +
    value + '\r\n'
}

function filePart (name, data) {
  return '--' + BOUNDARY + '\r\n' +
    'Content-Disposition: form-data; name="' + name + '"; filename="' + name + '.bin"\r\n' +
    'Content-Type: application/octet-stream\r\n\r\n' +
    data + '\r\n'
}

function body (parts) {
  return Buffer.from(parts.join('') + '--' + BOUNDARY + '--\r\n')
}

function inheritingLimits (proto) {
  var limits = Object.create(proto)
  limits.fileSize = 16
  return limits
}

function send (proto, parts, callback) {
  var data = body(parts)
  var req = new stream.PassThrough()
  req.headers = {
    'content-type': 'multipart/form-data; boundary=' + BOUNDARY,
    'content-length': String(data.length)
  }

  multer({ limits: inheritingLimits(proto) }).any()(req, null, callback)
  req.end(data)
}

describe('File size limit with inherited limits', function () {
  it('still applies limits inherited from a prototype', function (done) {
    var cases = [
      {
        name: 'files',
        proto: { files: 1 },
        parts: [filePart('a', 'aaaa'), filePart('b', 'bbbb')],
        code: 'LIMIT_FILE_COUNT'
      },
      {
        name: 'parts',
        proto: { parts: 1 },
        parts: [textPart('note', 'hi'), filePart('a', 'aaaa')],
        code: 'LIMIT_PART_COUNT'
      },
      {
        name: 'fieldSize',
        proto: { fieldSize: 4 },
        parts: [textPart('note', 'longer than four')],
        code: 'LIMIT_FIELD_VALUE'
      }
    ]

    function run (i) {
      if (i === cases.length) return done()

      var current = cases[i]
      send(current.proto, current.parts, function (err) {
        try {
          assert.ok(err, 'inherited ' + current.name + ' limit was not applied')
          assert.ok(err instanceof multer.MulterError)
          assert.strictEqual(err.code, current.code)
        } catch (e) {
          return done(e)
        }
        run(i + 1)
      })
    }

    run(0)
  })
})

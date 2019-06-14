var tape = require('tape')
var sodium = require('sodium-universal')
var create = require('./helpers/create')

tape('write and read', function (t) {
  var drive = create()

  drive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    drive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('world'))
      t.end()
    })
  })
})

tape('write and read, with encoding', function (t) {
  var drive = create()

  drive.writeFile('/hello.txt', 'world', { encoding: 'utf8' }, function (err) {
    t.error(err, 'no error')
    drive.readFile('/hello.txt', { encoding: 'utf8' }, function (err, str) {
      t.error(err, 'no error')
      t.same(str, 'world')
      t.end()
    })
  })
})

tape('write and read (2 parallel)', function (t) {
  t.plan(6)

  var drive = create()

  drive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    drive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('world'))
    })
  })

  drive.writeFile('/world.txt', 'hello', function (err) {
    t.error(err, 'no error')
    drive.readFile('/world.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('hello'))
    })
  })
})

tape('write and read (sparse)', function (t) {
  t.plan(2)

  var drive = create()
  drive.on('ready', function () {
    var clone = create(drive.key, {sparse: true})

    var s1 = clone.replicate({ live: true, encrypt: false })
    var s2 = drive.replicate({ live: true, encrypt: false})
    s1.pipe(s2).pipe(s1)

    drive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      setTimeout(() => {
        var readStream = clone.createReadStream('/hello.txt')
        readStream.on('data', function (data) {
          t.same(data.toString(), 'world')
        }, 50)
      })
    })
  })
})

tape('root is always there', function (t) {
  var drive = create()

  drive.access('/', function (err) {
    t.error(err, 'no error')
    drive.readdir('/', function (err, list) {
      t.error(err, 'no error')
      t.same(list, [])
      t.end()
    })
  })
})

tape('provide keypair', function (t) {
  var publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
  var secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)

  sodium.crypto_sign_keypair(publicKey, secretKey)

  var drive = create(publicKey, {secretKey: secretKey})

  drive.on('ready', function () {
    t.ok(drive.writable)
    t.ok(drive.metadata.writable)
    t.ok(publicKey.equals(drive.key))

    drive.writeFile('/hello.txt', 'world', function (err) {
      t.error(err, 'no error')
      drive.readFile('/hello.txt', function (err, buf) {
        t.error(err, 'no error')
        t.same(buf, Buffer.from('world'))
        t.end()
      })
    })
  })
})

tape('write and read, no cache', function (t) {
  var drive = create({
    metadataStorageCacheSize: 0,
    contentStorageCacheSize: 0,
    treeCacheSize: 0
  })

  drive.writeFile('/hello.txt', 'world', function (err) {
    t.error(err, 'no error')
    drive.readFile('/hello.txt', function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('world'))
      t.end()
    })
  })
})

tape('can read a single directory', async function (t) {
  const drive = create(null)

  let files = ['a', 'b', 'c', 'd', 'e', 'f']
  let fileSet = new Set(files)

  for (let file of files) {
    await insertFile(file, 'a small file')
  }

  drive.readdir('/', (err, files) => {
    t.error(err, 'no error')
    for (let file of files) {
      t.true(fileSet.has(file), 'correct file was listed')
      fileSet.delete(file)
    }
    t.same(fileSet.size, 0, 'all files were listed')
    t.end()
  })

  function insertFile (name, content) {
    return new Promise((resolve, reject) => {
      drive.writeFile(name, content, err => {
        if (err) return reject(err)
        return resolve()
      })
    })
  }
})

tape('can stream a large directory', async function (t) {
  const drive = create(null)

  let files = new Array(1000).fill(0).map((_, idx) => '' + idx)
  let fileSet = new Set(files)

  for (let file of files) {
    await insertFile(file, 'a small file')
  }

  let stream = drive.createDirectoryStream('/')
  stream.on('data', ({ path, stat }) => {
    if (!fileSet.has(path)) {
      return t.fail('an incorrect file was streamed')
    }
    fileSet.delete(path)
  })
  stream.on('end', () => {
    t.same(fileSet.size, 0, 'all files were streamed')
    t.end()
  })

  function insertFile (name, content) {
    return new Promise((resolve, reject) => {
      drive.writeFile(name, content, err => {
        if (err) return reject(err)
        return resolve()
      })
    })
  }
})

tape('can read nested directories', async function (t) {
  const drive = create(null)

  let files = ['a', 'b/a/b', 'b/c', 'c/b', 'd/e/f/g/h', 'd/e/a', 'e/a', 'e/b', 'f', 'g']
  let rootSet = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  let bSet = new Set(['a', 'c'])
  let dSet = new Set(['e'])
  let eSet = new Set(['a', 'b'])
  let deSet = new Set(['f', 'a'])

  for (let file of files) {
    await insertFile(file, 'a small file')
  }

  await checkDir('/', rootSet)
  await checkDir('b', bSet)
  await checkDir('d', dSet)
  await checkDir('e', eSet)
  await checkDir('d/e', deSet)

  t.end()

  function checkDir (dir, fileSet) {
    return new Promise(resolve => {
      drive.readdir(dir, (err, files) => {
        t.error(err, 'no error')
        for (let file of files) {
          t.true(fileSet.has(file), 'correct file was listed')
          fileSet.delete(file)
        }
        t.same(fileSet.size, 0, 'all files were listed')
        return resolve()
      })
    })
  }

  function insertFile (name, content) {
    return new Promise((resolve, reject) => {
      drive.writeFile(name, content, err => {
        if (err) return reject(err)
        return resolve()
      })
    })
  }
})

tape('can read sparse metadata', async function (t) {
  const { read, write } = await getTestDrives()

  let files = ['a', 'b/a/b', 'b/c', 'c/b', 'd/e/f/g/h', 'd/e/a', 'e/a', 'e/b', 'f', 'g']

  for (let file of files) {
    await insertFile(file, 'a small file')
    await checkFile(file)
  }

  t.end()

  function checkFile (file) {
    return new Promise(resolve => {
      read.stat(file, (err, st) => {
        t.error(err, 'no error')
        t.true(st)
        return resolve()
      })
    })
  }

  function insertFile (name, content) {
    return new Promise((resolve, reject) => {
      write.writeFile(name, content, err => {
        if (err) return reject(err)
        return resolve()
      })
    })
  }

  function getTestDrives () {
    return new Promise(resolve => {
      let drive = create()
      drive.on('ready', () => {
        let clone = create(drive.key, { sparseMetadata: true, sparse: true })
        let s1 = clone.replicate({ live: true })
        s1.pipe(drive.replicate({ live: true })).pipe(s1)
        return resolve({ read: clone, write: drive })
      })
    })
  }
})

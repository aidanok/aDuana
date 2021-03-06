const path = require('path');
const fs = require('fs');
const parse = require('url-parse');
const Hapi = require('@hapi/hapi');
const ObjectId = require('mongodb').ObjectId;
const mongo = require('mongodb').MongoClient;
const CronJob = require('cron').CronJob;
const Boom = require('@hapi/boom')
const readingTime = require('reading-time');
const htmlMinifier = require('@node-minify/html-minifier');
const minify = require('@node-minify/core');


const {initArweave, isTxSynced, dispatchTX} = require('./routines/arweave');
const {getContentEmbedded, getContentAndMetadataEmbedded, downloadRemote} = require("./routines/bundler")
const ejs = require('ejs')

const config_js = fs.readFileSync('static/config.js', {encoding: 'utf-8'})
const fontello_css = fs.readFileSync('static/fontello.css', {encoding: 'utf-8'})
const index_css = fs.readFileSync('static/index.css', {encoding: 'utf-8'})
const index_js = fs.readFileSync('static/index.js', {encoding: 'utf-8'})
const mini_dark = fs.readFileSync('node_modules/mini.css/dist/mini-dark.min.css')
const mini_default = fs.readFileSync('node_modules/mini.css/dist/mini-default.min.css')
const mini_nord = fs.readFileSync('node_modules/mini.css/dist/mini-nord.min.css')
const mili = fs.readFileSync('node_modules/milligram/dist/milligram.min.css')

const argv = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .command('aduana', 'The line between the web and the permaweb')
  .option('port', {
    alias: 'p',
    nargs: 1,
    description: 'server port number',
    default: 1908,
    type: 'number'
  })
  .option('host', {
    alias: 'H',
    nargs: 1,
    description: 'server host address',
    default: 'localhost',
    type: 'string'
  })
  .option('arweave', {
    alias: 'a',
    nargs: 1,
    coerce: parse,
    description: 'Arweave URL host',
    default: 'https://arweave.net',
    type: 'string'
  })
  .option('wallet-file', {
    alias: 'w',
    nargs: 1,
    description: 'wallet to get ar tokens',
    demandOption: 'Specify a wallet file',
    type: 'string'
  })
  .help('help')
  .argv;


const raw_wallet = fs.readFileSync(argv.walletFile);
const wallet = JSON.parse(raw_wallet);

const arweave = initArweave(argv.arweave);

const url = 'mongodb://localhost:27017';

let client;
let db;

const APP_NAME = 'aDuana-Test';
const APP_VERSION = '0';

const HOURLY = '0 0 */1 * * *';
const MINUTES = '0 */2 * * * *';

const getSiteDomain = (site_raw) => {
  console.log(site_raw)
  let site = parse(site_raw);
  let domain = site.host
  let protocol = site.protocol || 'http:'
  let path = site.pathname || '/'
  let fullsite = `${protocol}//${domain}${path}`

  return {
    fullsite,
    protocol,
    path,
    domain: site.host.split('.').slice(-2).join('.'),
    feedUrl: site_raw
  };
};


const build_document = async (page) => {
  let doc;
  if (page.type === 'text/html') {
    doc = {
      site: {
        title: page.resultMetadata.title,
        link: page.url,
        domain: page.site.domain,
        description: page.resultMetadata.description,
        sentiment_rate: page.resultMetadata.sentiment_rate,
        sentiment_group: page.resultMetadata.sentiment_group,
        language: page.resultMetadata.language,
        provider: page.resultMetadata.provider
      },
      stats: page.stats,
      type: 'text/html',
      item: {
        parser: page.parser,
        mode: page.mode,
        reset: page.reset,
        libstyle: page.libstyle,
        header: page.header,
        format: page.format,
        engine: page.engine,
        data: page.data,
        favicon: page.favicon,
        image: page.thumbnail
      },
      metadata: page.resultMetadata,
      url: page.url,
      pubDateObj: new Date(),
      published: false, tx: null
    };
  } else {
    doc = {
      url: page.url,
      ref: page.ref,
      item: page.data,
      type: page.type,
      pubDateObj: new Date(),
      published: false, tx: null
    }
  }

  return doc
};

const buildTxData = async (next) => {
  console.log(next.url);
  let collection = db.collection('entries');
  if (next.type === 'text/html') {
    let favicon =  await collection.findOne({url: next.metadata.icon});
    let image = await collection.findOne({url: next.metadata.image});
    let metadata = {
      ...next.metadata
    };

    if (favicon !== null) {
      metadata.icon = `https://arweave.net/${favicon.tx}`
    }

    if (image !== null) {
      metadata.image = `https://arweave.net/${image.tx}`
    }

    let data = {
      parser: next.item.parser,
      mode: next.item.mode,
      reset: next.item.reset,
      mini: next.item.libstyle,
      header: next.item.header,
      format: next.item.format,
      engine: next.item.engine,
      data: next.item.data,

      stats: next.stats,
      // files to embed
      config_js,
      fontello_css,
      index_css,
      index_js,
      mili,

      content: next.item.data.content,
      metadata: metadata,
      author: metadata.author || ""
    };

    let options = {
      root:  path.join(__dirname, 'templates'),
      async: true,
      rmWhitespace: true
    };

    let doc = await ejs.renderFile('templates/template.html', data, options);
    //let doc = await minify({
    //  compressor: htmlMinifier,
    //  content: _doc
    //});
    // console.log(doc)
    return doc;
  }
  return Buffer.from(next.item, 'base64');
};

const buildTxTags = (next) => {
  let tags;

  if (next.type === 'text/html') {
    tags = {
      'Feed-Name': APP_NAME,
      'Feed-Version': APP_VERSION,
      'Sentiment-Rate': Math.round(next.site.sentiment_rate),
      'Sentiment-Group': next.site.sentiment_group,
      'Publication-Date': next.pubDateObj.toISOString().slice(0,10),
      'Publication-Time': next.pubDateObj.toISOString().slice(11,16),
      'Publication-Domain': next.site.domain,
      'Publication-Provider': next.site.provider,
      'Publication-URL': next.url,
      'Publication-Lang': next.site.language ? next.site.language.split('-')[0].toUpperCase() : '',
      'Site-Title': next.site.title,
      'Content-Type': next.type,
      'Reading-Time': Math.round(next.stats.minutes),
    }
  } else {
    tags = {
      'Content-Type': next.type,
      'Publication-Date': next.pubDateObj.toISOString().slice(0,10),
      'Publication-Time': next.pubDateObj.toISOString().slice(11,16),
      'Publication-URL': next.ref,
      'Resource-URL': next.url
    }
  }

  // if (next.item.categories !== null && next.item.categories !== undefined &&
  //    next.item.categories.length > 0) {
  //  for (let i=0; i<5; i++) {
  //    if (next.item.categories[i] !== undefined && next.item.categories[i] !== null) {
  //      tags[`Category_${i}`] = next.item.categories[i].toLowerCase();
  //    }
  //  }
  // }

  console.log(tags)
  return tags;
};

const start_jobs = async () => {
  console.log(`Start jobs`);

  // Deploy next entry
  let deploy = async function(){
    let collection = db.collection('entries');
    console.log(`== Check sincronization`);
    let last = await collection.findOne({published: false, tx: {$ne: null}});
    if (last !== undefined && last !== null && last !== '') {
      console.log(`== Active Tx: _id: ${last._id} td: ${last.tx}`);
      let synced = await isTxSynced(arweave, last.tx);
      console.log(synced.confirmed)
      console.log(`Transaction status: ${synced.status} - ${synced.confirmed}`);
      if (synced.confirmed !== null && typeof  synced.confirmed === 'object' && synced.confirmed.number_of_confirmations > 2) {
        console.log(`Liberando: ${last.tx}`);
        collection.update({_id: last._id}, {$set: { published: true }})
        deploy()
      }
      if (synced.status == 404) {
        if (last.errors == undefined || last.errors == null ) {
          console.log('-- Estableciendo contador')
          await collection.update({_id: last._id}, {$set: { errors: 0 }})
        }
        if (last.errors >= 15) {
          console.log('-- Reintentado contador')
          await collection.update({_id: last._id}, {$set: { errors: 0, tx: null}})
          deploy()
        } else {
          console.error(`-- Incrementando contador de error ${last.errors}`)
          await collection.update({_id: last._id}, {$inc: { errors: 1 }})
        }
      }

    } else {
      console.log(`== Select next entry`);
      let next = await db.collection('entries').findOne({tx: null});
      if (next === undefined || next === null || next === '') {
        console.log('--- No task exists')
	      return;
      }
      console.log(next._id)
      // console.log(`${next._id} : ${next.item.title}`);
      try {
        res = await dispatchTX(arweave, await buildTxData(next), buildTxTags(next), wallet)
        // console.log(response.data)
      } catch(e) {
        console.log(e)
        console.error(`!! Failed ${next._id} : ${next.item.title}`);
        return;
      }

      let {response, tx} = res;
      console.log(response.data)
      if (response.status === 200) {
        console.log(`New pending transaction: ${tx.get('id')}`);
        collection.update({_id: next._id}, {$set: {'tx': tx.get('id'), published: false }})
      }

    }
  }
  let deployEntries = new CronJob(MINUTES, deploy);

  deployEntries.start()
};

const init = async () => {
  const server = Hapi.server({
    port: argv.port,
    host: argv.host
  });

  await server.register({
    plugin: require('@hapi/inert')
  })

  await server.register(require('@hapi/vision'));
  server.views({
    engines: {
      html: require('ejs')
    },
    relativeTo: __dirname,
    path: 'templates'
  });

  server.route({
    method: 'GET',
    path: '/activity',
    handler: async (request, h) => {
      try {
        const address = await arweave.wallets.jwkToAddress(wallet);
        const balance = await arweave.wallets.getBalance(address);
        let collection = db.collection('entries');

        let approved = await (collection.find({published: true, type: 'text/html'})).toArray()
        let pending = await (collection.find({published: false, type: 'text/html'})).toArray()
        return h.view('activity', {address, balance, approved, pending});
      } catch(e){console.log(e)}
    }
  });

  server.route({
    method: 'GET',
    path: '/status',
    handler: async (request, h) => {
      let collection = db.collection('entries');
      const address = await arweave.wallets.jwkToAddress(wallet);
      const balance = await arweave.wallets.getBalance(address);

      try {
        const id = request.query.id;
        const obj = await collection.findOne({_id: new ObjectId(id)})

        return h.view('status', {address, balance, obj: obj});
      } catch(e){
        console.log(e)
        return h.view('status', {address, balance, obj: undefined});
      }
    }
  });

  server.route({
    method: 'GET',
    path: '/',
    handler: async (request, h) => {
      try {
        const address = await arweave.wallets.jwkToAddress(wallet);
        const balance = await arweave.wallets.getBalance(address);

        return h.view('preview', {address, balance});
      } catch(e){console.log(e)}
    }
  });

  server.route({
    method: 'GET',
    path: '/preview',
    handler: async (request, h) => {
      try{
        let sites = db.collection('entries');
        let site_raw = request.query.site;
        let parser = request.query.parser || 'readability';
        let mode = request.query.mode || 'sepia';
        let reset = request.query.reset === 'on';
        let libstyle = request.query.libstyle === 'on';
        let header = request.query.header === 'on';
        let format = request.query.format || 'html';
        let engine = request.query.engine || 'browser';
        let obj_site = parse(site_raw);
        let domain = obj_site.host;

        if (domain === '' || domain === undefined) {
          return Boom.badData('Url format must be protocol://domain/path');
        }

        const address = await arweave.wallets.jwkToAddress(wallet);
        let {resultArticle, resultMetadata} = await getContentAndMetadataEmbedded(site_raw, parser, format, engine);
        let stats = readingTime(resultArticle.content)

        return h.view('template', {
          header,
          address,
          config_js,
          fontello_css,
          index_css,
          index_js,
          mini_dark,
          mini_default,
          mini_nord,
          mini: libstyle,
          mili,
          reset,
          libstyle,
          stats,
          mode,
          content: resultArticle.content,
          metadata: resultMetadata,
          author: resultMetadata.author || ""
        });
      } catch(e){
        console.log(e);
        return Boom.badImplementation(`${e}`);
      }
    }
  });

  server.route({
    method: 'GET',
    path: '/request',
    handler: async (request, reply) => {
      try{
        let sites = db.collection('entries');
        let site_raw = request.query.site;
        let parser = request.query.parser || 'readability';
        let format = request.query.format || 'html';
        let engine = request.query.engine || 'browser';
        let obj_site = parse(site_raw);
        let domain = obj_site.host;

        if (domain === '' || domain === undefined) {
          return Boom.badData('Url format must be protocol://domain/path');
        }


        let {resultArticle, resultMetadata} = await getContentAndMetadataEmbedded(site_raw, parser, format, engine);
        let stats = readingTime(resultArticle.content)

        return {
          status: 'ok',
          data: resultArticle,
          metadata: resultMetadata,
          stats
        };
      } catch(e){
        console.log(e);
        return Boom.badImplementation(`${e}`);
      }
    }
  });

  server.route({
    method: 'POST',
    path: '/request',
    handler: async (request, h) => {
      try{
        let sites = db.collection('entries');
        let site_raw = request.query.site;
        let parser = request.query.parser;
        let mode = request.query.mode || 'sepia';
        let reset = request.query.reset === 'on';
        let libstyle = request.query.libstyle === 'on';
        let header = request.query.header === 'on';
        let format = request.query.format || 'html';
        let engine = request.query.engine || 'browser';
        let obj_site = parse(site_raw);
        let domain = obj_site.host;

        if (domain === '' || domain === undefined) {
          return Boom.badData('Url format must be protocol://domain/path');
        }

        let site = await sites.findOne({url: site_raw});
        if (site === null) {
          const address = await arweave.wallets.jwkToAddress(wallet);
          let {resultArticle, resultMetadata} = await getContentAndMetadataEmbedded(site_raw, parser, format, engine);
          let stats = readingTime(resultArticle.content)

          let thumbnail_id;
          let icon_id;

          let icon = await sites.findOne({url: resultMetadata.icon});
          if (icon !== null) {
            console.log('reusing id for icon')
            icon_id = icon._id
          } else if (resultMetadata.icon) {
            let icon = await downloadRemote(resultMetadata.icon)
            if (icon.data.toString().length > 0) {
              let favicon = await sites.insertOne(await build_document({
                url: resultMetadata.icon,
                data: icon.data.toString('base64'),
                type: icon.data.type || "image/x-icon",
                ref: site_raw
              }));
              icon_id = favicon.ops[0]._id
            }
          }

          let i = await sites.findOne({url: resultMetadata.image});
          if (i !== null) {
            console.log('reusing id for thumbnail')
            thumbnail_id = i._id
          } else if (resultMetadata.image) {
            let image = await downloadRemote(resultMetadata.image);
            if (image.data.toString().length > 0) {
              let thumbnail = await sites.insertOne(await build_document({
                url: resultMetadata.image,
                data: image.data.toString('base64'),
                type: image.data.type || "image/jpeg",
                ref: site_raw
              }));
              thumbnail_id = thumbnail.ops[0]._id
            }
          }

          const new_site = await sites.insertOne(await build_document({
            url: site_raw,
            site: getSiteDomain(site_raw),
            stats,
            type: 'text/html',
            parser,
            mode,
            reset,
            libstyle,
            header,
            format,
            engine,
            data: resultArticle,
            resultMetadata,
            favicon: icon_id,
            image: thumbnail_id
          }));
          console.log(new_site.ops[0]._id)
          let link = '/status?id=' + new_site.ops[0]._id;
          return {
            status: 'ok',
            message: `Wait until the page is mined, <a href="${link}">you see the progress here</a>"`,
            url: link
          };

        }  else {
          console.log('** URL Saved');
          let link = '/status?id=' + site._id;
          return {
            status: 'ok',
            message: `<a href="${link}">Site already exists, check status here</a>`,
            url: link
          };
        }

      } catch(e){
        console.log(e);
        return Boom.badImplementation(`${e}`);
      }
    }
  });

  server.route({
    method: 'GET',
    path: '/static/{file*}',
    handler: {
      directory: {
        path: 'static'
      }
    }
  })

  client = await mongo.connect(url, {useNewUrlParser: true});
  db = client.db('aduana');

  await start_jobs();
  await server.start();
  console.log('Server running on %s', server.info.uri);
};

process.on('unhandledRejection', (err) => {
  console.log(err);
  process.exit(1);
});

process.on('uncaughtException', function (err) {
  console.log(err);
  process.exit(1);

});

init();

'use strict'

const PER_PAGE = 100
// const USER = 'millette'

if (!process.argv[2]) { throw new Error('Missing user argument.') }

const USER = process.argv[2]

// core
const https = require('https')

// npm
const JSONStream = require('JSONStream')
// const pick = require('lodash.pickby')

// const slim = (user) => pick(user, Boolean)

const setup = () => {
  const { readFileSync } = require('fs')
  const { parse } = require('dotenv')
  const url = require('url')
  process.env = { ...process.env, ...parse(readFileSync('.env')) }
  const { name, version } = require('./package.json')
  return {
    request: https.request.bind(null, {
      method: 'POST',
      ...url.parse('https://api.github.com/graphql'),
      // ...new URL('https://api.github.com/graphql'),
      headers: {
        'User-Agent': name + ' ' + version,
        Authorization: 'bearer ' + process.env.GITHUB_TOKEN
      }
    })
  }
}

const { request } = setup()
const resFnImp = (res, reject, str, cb, all) => res
  .pipe(JSONStream.parse(str))[all ? 'on' : 'once']('data', cb).once('error', reject)

const doone = (userFn, vars) => new Promise((resolve, reject) => {
  if (typeof vars === 'object' && !Object.keys(vars).length) { vars = false }
  if (typeof vars !== 'object') { vars = false }
  const dq = {
    query: `query${vars ? ' ($after:String!)' : ''} {
      rateLimit {
        cost
        limit
        nodeCount
        remaining
        resetAt
      }

      user(login: "${USER}") {
        repositoriesContributedTo(first: ${PER_PAGE}${vars ? ' , after: $after' : ''}, orderBy: {field: UPDATED_AT, direction: DESC}) {
          edges {
            node {
              nameWithOwner
            }
          }
          totalCount
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }
    }`.replace(/ /g, '')
  }

  if (vars) { dq.variables = { after: vars.after } }
  // console.error('DQ:', dq)
  return request((res) => {
    if (res.statusCode !== 200) {
      console.error('HEADERS:', res.headers)
      console.error('VARS:', vars)
      return reject(new Error('Bad status code: ' + res.statusCode))
    }
    res.setEncoding('utf8')
    const ret = { done: 0, headers: res.headers }
    if (vars.allDone) { ret.allDone = vars.allDone }
    res.once('end', () => resolve(ret))
    const resFn = resFnImp.bind(null, res, reject)
    const counter = (user) => {
      ++ret.done
      // return userFn(slim(user))
      return userFn(user)
    }
    resFn('data.user.repositoriesContributedTo.edges.*.node.nameWithOwner', counter, true)
    resFn('data.rateLimit', (rateLimit) => {
      ret.rateLimit = rateLimit
      const sd = Date.parse(res.headers.date)
      ret.rateLimit.serverDate = new Date(sd).toISOString().replace('.000', '')
      const ed = Date.parse(rateLimit.resetAt)
      ret.rateLimit.secondsLeft = Math.round((ed - sd) / 1000)
    })
    resFn('data.user.repositoriesContributedTo.totalCount', (count) => { ret.count = count })
    resFn('data.user.repositoriesContributedTo.pageInfo', (pageInfo) => {
      if (pageInfo.hasNextPage) { ret.after = pageInfo.endCursor }
    })
  })
    .once('error', reject)
    .end(JSON.stringify(dq))
})

const dothem2 = async (userFn, vars) => {
  // const now = Date.now()
  const ret = await doone(userFn, vars)
  ret.allDone = ret.allDone ? (ret.allDone + ret.done) : ret.done

  /*
  if (vars && vars.rateLimit) { console.error('RATELIMIT-vars:', vars.rateLimit) }
  console.error('RATELIMIT-ret:', ret.rateLimit)
  const pagesLeft = ret.rateLimit.remaining / ret.rateLimit.cost
  const pageSpeed = Math.round(1000 * ret.rateLimit.secondsLeft / pagesLeft) / 1000
  console.error('ELAPSED:', Math.round(Date.now() - now), ret.count, ret.allDone, PER_PAGE, ret.count, pageSpeed)
  */
  if (ret.after) { return dothem2(userFn, ret) }
  if (ret.allDone !== ret.count) { console.error('Warning, incomplete!') }
  return ret
}

module.exports = { doone, dothem2 }

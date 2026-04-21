#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { listProviderSearchResults } = require('../services/provider-search-service');

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const out = listProviderSearchResults({
  taxonomyCode: getArg('taxonomy', null),
  latitude: getArg('lat', null),
  longitude: getArg('lon', null),
  radiusMiles: getArg('radius-miles', null),
  payorEntityId: getArg('payor-entity-id', null),
  page: getArg('page', 1),
  pageSize: getArg('page-size', 25)
});

console.log(JSON.stringify({ event: 'provider_specialty_search_completed', ...out }, null, 2));


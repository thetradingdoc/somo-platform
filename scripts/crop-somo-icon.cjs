#!/usr/bin/env node
'use strict';

/**
 * @deprecated Use prepare-somo-icon.cjs with a dedicated icon source PNG.
 * Cropping the botanical mark from the wordmark is no longer used — icon is a separate asset.
 */

console.error('brand:crop-icon is deprecated. Use: npm run brand:prepare-icon -- <source.png>');
process.exit(1);

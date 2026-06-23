/**
 * Verify RapidAPI Key Format
 * 
 * Helps identify if the API key format is correct
 */

const key = process.argv[2] || 'api_6a5ee8ca-4932-4fa3-b62c-0ef0e071e3ca';

console.log('🔍 Analyzing API Key Format...\n');
console.log('Key:', key);
console.log('Length:', key.length);
console.log('Starts with "api_":', key.startsWith('api_'));
console.log('');

// RapidAPI keys typically:
// - Are 40+ characters long
// - Don't start with "api_" (that's usually a placeholder)
// - Are alphanumeric with possible dashes/underscores

if (key.startsWith('api_')) {
    console.log('⚠️  WARNING: Keys starting with "api_" are often placeholders!');
    console.log('   Your actual RapidAPI key should be from:');
    console.log('   1. Go to rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch');
    console.log('   2. Click "Code Snippets" tab');
    console.log('   3. Look for "x-rapidapi-key" in the code example');
    console.log('   4. Copy that value (it will be a long alphanumeric string)');
    console.log('');
}

if (key.length < 30) {
    console.log('⚠️  WARNING: Key seems too short. RapidAPI keys are usually 40+ characters.');
    console.log('');
}

console.log('💡 To get your actual API key:');
console.log('   1. Log into RapidAPI.com');
console.log('   2. Go to your account settings or the JSearch API page');
console.log('   3. Find your "X-RapidAPI-Key" (it\'s your account-wide key)');
console.log('   4. Or use the key shown in the JSearch API code snippets');
console.log('');


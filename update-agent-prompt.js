/**
 * UPDATE RETELL AGENT PROMPT
 * 
 * Run: node update-agent-prompt.js [agent_id]
 * 
 * This will update your existing Retell agent(s) with the new multilingual prompt
 * 
 * Usage:
 *   node update-agent-prompt.js                    # Updates default agent
 *   node update-agent-prompt.js agent_123          # Updates specific agent
 *   node update-agent-prompt.js --all              # Updates all agents from database
 */

require('dotenv').config();
const RetellService = require('./middleware-platform/services/retell-service');
const fs = require('fs');
const path = require('path');

// Get agent ID from command line or environment or use default
const args = process.argv.slice(2);
const updateAll = args.includes('--all');
const specificAgentId = args.find(arg => !arg.startsWith('--') && arg.startsWith('agent_'));
const AGENT_ID = specificAgentId || process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a';

async function updateAgentPrompt(agentId) {
    const retellService = new RetellService();

    // Load the updated prompt
    const promptPath = path.join(__dirname, 'docs/voice-agent/kelly-voice-agent-prompt.md');

    if (!fs.existsSync(promptPath)) {
        console.error('❌ Prompt file not found:', promptPath);
        return { success: false, error: 'Prompt file not found' };
    }

    const prompt = fs.readFileSync(promptPath, 'utf8');

    console.log(`\n📞 Updating agent: ${agentId}`);

    // Update the agent
    const result = await retellService.updateAgent(agentId, {
        system_prompt: prompt
    });

    if (result.success) {
        console.log(`   ✅ Agent ${agentId} updated successfully!`);
    } else {
        console.error(`   ❌ Failed to update agent ${agentId}:`);
        console.error(`      Error: ${result.error}`);
        if (result.error_details) {
            console.error(`      Details:`, JSON.stringify(result.error_details, null, 2));
        }
    }

    return result;
}

async function getAllAgentIds() {
    try {
        const dbModule = require('./middleware-platform/database');
        const db = dbModule.db;

        // Get all unique agent IDs from customers table
        const agents = db.prepare(`
      SELECT DISTINCT retell_agent_id 
      FROM customers 
      WHERE retell_agent_id IS NOT NULL 
        AND retell_agent_id != ''
    `).all();

        return agents.map(row => row.retell_agent_id);
    } catch (error) {
        console.error('⚠️  Could not fetch agent IDs from database:', error.message);
        return [];
    }
}

async function main() {
    console.log('\n🔄 UPDATING RETELL AGENT(S) WITH MULTILINGUAL PROMPT\n');

    // Load the updated prompt (validate file exists)
    const promptPath = path.join(__dirname, 'docs/voice-agent/kelly-voice-agent-prompt.md');

    if (!fs.existsSync(promptPath)) {
        console.error('❌ Prompt file not found:', promptPath);
        process.exit(1);
    }

    const prompt = fs.readFileSync(promptPath, 'utf8');
    console.log('✅ Loaded prompt from:', promptPath);
    console.log(`   Prompt length: ${prompt.length} characters\n`);

    let agentIds = [];

    if (updateAll) {
        console.log('📋 Fetching all agent IDs from database...');
        agentIds = await getAllAgentIds();

        if (agentIds.length === 0) {
            console.log('⚠️  No agent IDs found in database. Using default agent ID.');
            agentIds = [AGENT_ID];
        } else {
            console.log(`   Found ${agentIds.length} agent(s) in database\n`);
        }
    } else {
        agentIds = [AGENT_ID];
    }

    // Update all agents
    const results = [];
    for (const agentId of agentIds) {
        const result = await updateAgentPrompt(agentId);
        results.push({ agentId, success: result.success });
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 UPDATE SUMMARY');
    console.log('='.repeat(60));

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`   ✅ Successful: ${successful}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📝 Total: ${results.length}`);

    if (successful > 0) {
        console.log('\n🎉 Multilingual support is now enabled!');
        console.log('   Test it by calling your agent and saying: "I don\'t speak English. I speak Russian."\n');
    }

    if (failed > 0) {
        console.error('\n⚠️  Some agents failed to update. Check the errors above.\n');
        process.exit(1);
    }
}

// Run the update
main().catch(error => {
    console.error('\n❌ Unexpected error:', error.message);
    console.error(error.stack);
    process.exit(1);
});


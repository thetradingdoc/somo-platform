/**
 * Command Handler Service
 * Extensible command system for chat widget
 * Each command is a plugin that can be easily added
 */

class CommandHandler {
    constructor() {
        this.commands = new Map();
        this.middleware = [];
    }

    /**
     * Register a command handler
     * @param {string} name - Command name (e.g., 'promotion', 'product')
     * @param {object} handler - Handler object with methods
     * @param {function} handler.parse - Parse command and extract parameters
     * @param {function} handler.execute - Execute the command
     * @param {function} handler.validate - Validate parameters (optional)
     * @param {string} handler.description - Description for help
     * @param {array} handler.examples - Example commands
     */
    register(name, handler) {
        if (!handler.parse || !handler.execute) {
            throw new Error(`Command handler "${name}" must have parse and execute methods`);
        }

        this.commands.set(name.toLowerCase(), {
            name,
            ...handler,
            description: handler.description || `Handle ${name} commands`,
            examples: handler.examples || []
        });

        console.log(`✅ Registered command handler: ${name}`);
    }

    /**
     * Register middleware (runs before command execution)
     * @param {function} fn - Middleware function (async (context) => {})
     */
    use(fn) {
        this.middleware.push(fn);
    }

    /**
     * Parse a command and determine which handler to use
     * @param {string} command - User command
     * @param {object} context - Context (merchantId, customerId, conversationHistory)
     * @returns {object} Parsed command with handler info
     */
    async parse(command, context = {}) {
        const cmd = command.toLowerCase().trim();

        // Try each registered command handler
        for (const [name, handler] of this.commands.entries()) {
            try {
                const parsed = await handler.parse(cmd, context);
                if (parsed && parsed.matched) {
                    return {
                        handler: name,
                        handlerInstance: handler,
                        ...parsed
                    };
                }
            } catch (error) {
                console.warn(`Error parsing command "${name}":`, error.message);
                continue;
            }
        }

        return null; // No handler matched
    }

    /**
     * Execute a parsed command
     * @param {object} parsed - Parsed command from parse()
     * @param {object} context - Context (merchantId, customerId, etc.)
     * @returns {object} Execution result
     */
    async execute(parsed, context = {}) {
        if (!parsed || !parsed.handlerInstance) {
            throw new Error('Invalid parsed command');
        }

        const handler = parsed.handlerInstance;

        // Run middleware
        for (const middleware of this.middleware) {
            await middleware({ ...context, parsed });
        }

        // Validate if validator exists
        if (handler.validate) {
            const validation = handler.validate(parsed, context);
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error || 'Invalid parameters',
                    suggestions: validation.suggestions || []
                };
            }
        }

        // Execute command
        try {
            // Pass the full parsed object so handlers can access action, params, etc.
            const result = await handler.execute(parsed, context);
            return {
                success: true,
                ...result
            };
        } catch (error) {
            console.error(`Error executing command "${parsed.handler}":`, error);
            return {
                success: false,
                error: error.message || 'Command execution failed'
            };
        }
    }

    /**
     * Get help for all commands or a specific command
     * @param {string} commandName - Optional command name
     * @returns {object} Help information
     */
    getHelp(commandName = null) {
        if (commandName) {
            const handler = this.commands.get(commandName.toLowerCase());
            if (!handler) {
                return null;
            }
            return {
                name: handler.name,
                description: handler.description,
                examples: handler.examples
            };
        }

        // Return help for all commands
        const help = [];
        for (const [name, handler] of this.commands.entries()) {
            help.push({
                name: handler.name,
                description: handler.description,
                examples: handler.examples
            });
        }

        return help;
    }

    /**
     * List all registered commands
     * @returns {array} List of command names
     */
    listCommands() {
        return Array.from(this.commands.keys());
    }
}

// Export singleton instance
module.exports = new CommandHandler();


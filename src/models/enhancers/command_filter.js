import { getCommandDocs, getCommand } from '../../agent/commands/index.js';

/**
 * CommandFilter provides filtered command documentation for prompt enhancement.
 * This allows adding only relevant Minecraft commands to prompts based on context.
 */
export class CommandFilter {
    constructor(config) {
        this.config = config || {};
    }

    /**
     * Selects which commands should be included in the filtered command documentation.
     * 
     * This method is left empty for you to implement. You should return an array of
     * command names (with or without the '!' prefix) that should be included.
     * 
     * @param {Object} context - Context information that can be used to filter commands
     * @param {Array} context.messages - Recent conversation messages
     * @param {string} context.systemPrompt - The current system prompt
     * @param {Object} context.agent - The agent instance (optional, may be undefined)
     * @param {string} context.requestType - Type of request (e.g., "building", "crafting", "traveling")
     * @param {Object} context.additionalContext - Any additional context you want to pass
     * @returns {Array<string>} Array of command names to include (e.g., ["!newAction", "!goToPlayer"])
     */
    selectCommands(context) {
        // TODO: Implement your command selection logic here
        // 
        // Example implementations you might want:
        // - Filter by request type (building, crafting, etc.)
        // - Filter by current agent state (inventory, health, position)
        // - Filter by recent conversation context
        // - Filter by task/goal the agent is working on
        // - Use semantic similarity to match commands to conversation
        //
        // Return an empty array to include no commands, or return null/undefined
        // to include all commands (fallback to full command docs)
        
        return null; // Return null to include all commands by default
    }

    /**
     * Gets filtered command documentation based on the selection logic.
     * 
     * @param {Object} context - Context information for filtering
     * @param {Array} context.messages - Recent conversation messages
     * @param {string} context.systemPrompt - The current system prompt
     * @param {Object} context.agent - The agent instance (optional)
     * @param {string} context.requestType - Type of request (optional)
     * @param {Object} context.additionalContext - Any additional context
     * @returns {string} Filtered command documentation string
     */
    getFilteredCommandDocs(context = {}) {
        const selectedCommands = this.selectCommands(context);
        
        // If selectCommands returns null/undefined, return full command docs
        if (selectedCommands === null || selectedCommands === undefined) {
            return getCommandDocs();
        }
        
        // If empty array, return empty string (no commands)
        if (selectedCommands.length === 0) {
            return '';
        }
        
        // Build filtered command documentation
        return this._buildFilteredDocs(selectedCommands);
    }

    /**
     * Builds command documentation string from a list of selected command names.
     * 
     * @private
     * @param {Array<string>} commandNames - Array of command names to include
     * @returns {string} Formatted command documentation
     */
    _buildFilteredDocs(commandNames) {
        const typeTranslations = {
            'float': 'number',
            'int': 'number',
            'BlockName': 'string',
            'ItemName': 'string',
            'boolean': 'bool'
        };

        let docs = `\n*FILTERED COMMAND DOCS\n You can use the following commands to perform actions and get information about the world. 
    Use the commands with the syntax: !commandName or !commandName("arg1", 1.2, ...) if the command takes arguments.\n
    Do not use codeblocks. Use double quotes for strings. Only use one command in each response, trailing commands and comments will be ignored.\n`;
        
        for (let commandName of commandNames) {
            // Ensure command name has '!' prefix
            if (!commandName.startsWith('!')) {
                commandName = '!' + commandName;
            }
            
            const command = getCommand(commandName);
            if (!command) {
                console.warn(`CommandFilter: Command ${commandName} not found, skipping.`);
                continue;
            }
            
            docs += command.name + ': ' + command.description + '\n';
            if (command.params) {
                docs += 'Params:\n';
                for (let param in command.params) {
                    const paramType = typeTranslations[command.params[param].type] || command.params[param].type;
                    docs += `${param}: (${paramType}) ${command.params[param].description}\n`;
                }
            }
        }
        
        return docs + '*\n';
    }

    /**
     * Enhances a system prompt by adding filtered command documentation.
     * Can replace $COMMAND_DOCS placeholder or append filtered commands.
     * 
     * @param {string} systemPrompt - The original system prompt
     * @param {Object} context - Context for filtering commands
     * @param {Object} options - Options for enhancement
     * @param {boolean} options.replacePlaceholder - If true, replace $COMMAND_DOCS placeholder (default: true)
     * @param {boolean} options.appendIfNoPlaceholder - If true, append filtered docs if no placeholder found (default: false)
     * @returns {string} Enhanced system prompt
     */
    enhancePromptWithFilteredCommands(systemPrompt, context = {}, options = {}) {
        const {
            replacePlaceholder = true,
            appendIfNoPlaceholder = false
        } = options;

        const filteredDocs = this.getFilteredCommandDocs(context);
        
        // Replace $COMMAND_DOCS placeholder if it exists
        if (replacePlaceholder && systemPrompt.includes('$COMMAND_DOCS')) {
            return systemPrompt.replaceAll('$COMMAND_DOCS', filteredDocs);
        }
        
        // Append filtered docs if no placeholder and appendIfNoPlaceholder is true
        if (appendIfNoPlaceholder && !systemPrompt.includes('$COMMAND_DOCS')) {
            return systemPrompt + '\n\n' + filteredDocs;
        }
        
        return systemPrompt;
    }
}


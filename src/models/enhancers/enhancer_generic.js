import { getKey, hasKey } from '../../utils/keys.js';
import { strictFormat } from '../../utils/text.js';
import { getCommandDocs, getCommand } from '../../agent/commands/index.js';

export class generalEnhancer {
    constructor(config) {
        this.config = config;
        this.clusterTextLength = 5; // Default number of recent messages to analyze
    }

    cosineSimilarity(vecA, vecB) {
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        return dotProduct / (normA * normB);
    }

    /**
     * Builds filtered command documentation from a list of command names
     */
    _buildFilteredCommandDocs(commandNames) {
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
                console.warn(`generalEnhancer: Command ${commandName} not found, skipping.`);
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

    // Identify the type of request made by the user: "building", "crafting", "conversing", "traveling", "hunting", "collecting"
    async detectRequestType(turns, clusterTextLength = null) {
        if (!turns || turns.length === 0) {
            console.log("*** generalEnhancer: No turns provided, defaulting to 'conversing' ***");
            return 'conversing';
        }

        const fs = require('fs');
        const { pipeline } = require('@xenova/transformers');

        const categoryBase = {
            "building": "Let's build a house! I will build a church with oak planks and cobblestone. Let's light up this platform with torches. I ran out of wood, finding oak logs. Max, you build the walls, and I'll get started with the interior furniture.",
            "crafting": "Do you have any sticks? Oh, let me check my inventory to see if I have enought ingots. Let's find a crafting table. I have enough sticks to craft three diamond pickaxes, but do you have any diamonds. I only have eight planks, how many do you have? We need 6 sticks and 9 cobblestones. I can use this furnace and my coal to cook my raw beef. Do we have enough eggs? Is there enought iron ingots for this armor? Let's cook some more food.",
            "traveling": "I'm going to the other player. Follow me. Let's travel to the nether. Gonna head back to our base. Searching for wood logs right now. I can't find any ores nearby. Looking for some chickens. Heading to the coordinates you gave me.",
            "hunting": "Let's hunt down these sheep. I have to kill a lot of zombies. I have a stone sword to kill these pigs for pork. Time to attack!",
            "conversing": "Hi, my name is Steve. Hey Lucy, I'm Max. What do you want to do right now? I'm so bored, let's go do something.",
            "collecting": "Let's mine some stone. Now with an iron pickaxe, I can find some ores to mine. Finding wood to chop down, getting some oak logs. Searching for sand to collect. I'm trying to find some flowers. Still need to collect some more wood."
        };

        const lengthToUse = clusterTextLength || this.clusterTextLength;
        
        console.log("*** generalEnhancer: Starting request type detection ***");
        console.log(`*** generalEnhancer: Analyzing ${lengthToUse} recent messages from ${turns.length} total turns ***`);

        const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

        let iterator = turns.length - 1;
        let turnsAdded = 0;
        let clusterText = "";

        while (turnsAdded < lengthToUse && iterator >= 0) {
            const message = turns[iterator].content;
            if (turns[iterator].role === 'assistant') {
                clusterText += message + "\n";
                turnsAdded++;
            } else if (turns[iterator].role === 'user') {
                if (message.includes("FROM OTHER BOT")) {
                    const messageStart = message.indexOf("FROM OTHER BOT") + 15;
                    clusterText += message.slice(messageStart) + "\n";
                    turnsAdded++;
                } else {
                    // Include user messages too for better context
                    clusterText += message + "\n";
                    turnsAdded++;
                }
            }
            iterator--;
        }

        console.log("*** generalEnhancer: Cluster Text (recent messages analyzed) ***");
        console.log("=".repeat(80));
        console.log(clusterText);
        console.log("=".repeat(80));

        if (clusterText.trim().length === 0) {
            console.log("*** generalEnhancer: Cluster text is empty, defaulting to 'conversing' ***");
            return 'conversing';
        }

        const clusterEmbedding = await embedder(clusterText, { pooling: 'mean', normalize: true });
        const clusterVec = Array.from(clusterEmbedding.data);
        
        let requestType = null;
        let highestSimilarity = -1;
        const similarityScores = {};

        console.log("*** generalEnhancer: Computing similarity scores for each category ***");
        
        for (const [category, sampleText] of Object.entries(categoryBase)) {
            const categoryEmbedding = await embedder(sampleText, { pooling: 'mean', normalize: true });
            const categoryVec = Array.from(categoryEmbedding.data);

            const sim = this.cosineSimilarity(categoryVec, clusterVec);
            similarityScores[category] = sim;
            
            console.log(`*** generalEnhancer: ${category} similarity: ${sim.toFixed(4)} ***`);
            
            if (sim > highestSimilarity) {
                requestType = category;
                highestSimilarity = sim;
            }
        }

        console.log("*** generalEnhancer: Similarity Scores Summary ***");
        console.log("=".repeat(80));
        for (const [category, score] of Object.entries(similarityScores)) {
            const marker = category === requestType ? " <-- SELECTED" : "";
            console.log(`  ${category.padEnd(12)}: ${score.toFixed(4)}${marker}`);
        }
        console.log("=".repeat(80));
        console.log(`*** generalEnhancer: Selected category: "${requestType}" with confidence: ${highestSimilarity.toFixed(4)} ***`);
        
        return requestType || 'conversing';
    }

    // Optimize system prompt for the specific task
    optimizeSystemPrompt(requestType, originalSystemPrompt) {
        // reduce original prompt's COMMAND_DOCS
        // reduce STATS to position, health, hunger, current action, nearby bot players, nearby human players;  hard-code eating and food-finding below certain health/hunger
        // edit prompt to encourage inventory inspection and utilization

        const promptOptimizations = require('./prompt_optimizations.json');

        const includedCommands = {
            "building": ["!newAction", "!goToPlayer", "!givePlayer", "!putInChest", "!takeFromChest", "!viewChest", "!placeHere"],
            "crafting": ["!newAction", "!goToPlayer", "!givePlayer", "!takeFromChest", "!viewChest", "!craftRecipe", "!smeltItem"],
            "traveling": ["!newAction", "!goToPlayer", "!followPlayer"],
            "hunting": ["!newAction", "!goToPlayer", "!searchForEntity", "!equip", "!attack"],
            "conversing": ["!newAction", "!givePlayer", "!remember", "!goal", "!endGoal", "!startConversation", "!endConversation"],
            "collecting": ["!newAction", "!goToPlayer", "!searchForBlock", "!equip", "!collectBlocks", "!digDown"],
            "surviving": ["!newAction", "!consume", "!equip", "!putInChest", "!takeFromChest", "!viewChest", "!attack", "!attackPlayer", "!goToBed"]
        };

        let optimizedPrompt = originalSystemPrompt;
        
        // Add task-specific optimization instructions
        if (promptOptimizations[requestType]) {
            optimizedPrompt = optimizedPrompt + "\n\n" + promptOptimizations[requestType];
            console.log(`*** generalEnhancer: Added ${requestType} optimization instructions to prompt ***`);
        }

        // Replace $COMMAND_DOCS with filtered commands if the placeholder exists
        if (optimizedPrompt.includes('$COMMAND_DOCS')) {
            const commandsToInclude = includedCommands[requestType] || [];
            
            if (commandsToInclude.length > 0) {
                const filteredCommandDocs = this._buildFilteredCommandDocs(commandsToInclude);
                optimizedPrompt = optimizedPrompt.replaceAll('$COMMAND_DOCS', filteredCommandDocs);
                console.log(`*** generalEnhancer: Replaced $COMMAND_DOCS with ${commandsToInclude.length} filtered commands for ${requestType} category ***`);
                console.log(`*** generalEnhancer: Included commands: ${commandsToInclude.join(', ')} ***`);
            } else {
                // If no commands specified for this category, use full command docs
                optimizedPrompt = optimizedPrompt.replaceAll('$COMMAND_DOCS', getCommandDocs());
                console.log(`*** generalEnhancer: No specific commands for ${requestType}, using full command docs ***`);
            }
        }

        return optimizedPrompt;
    }

    async sendRequest(model, turns, systemPrompt, stop_seq = '***') {
        console.log("*** generalEnhancer: sendRequest called ***");
        console.log(`*** generalEnhancer: Number of turns: ${turns ? turns.length : 0} ***`);
        console.log(`*** generalEnhancer: System prompt length: ${systemPrompt ? systemPrompt.length : 0} characters ***`);
        
        // Find the request type through semantic comparisons
        const requestType = await this.detectRequestType(turns, this.clusterTextLength);
        
        // Optimize systemPrompt according to request type
        console.log(`*** generalEnhancer: ${requestType} request detected - optimizing system prompt ***`);
        let optimizedSystemPrompt = this.optimizeSystemPrompt(requestType, systemPrompt);
        
        console.log(`*** generalEnhancer: Optimized prompt length: ${optimizedSystemPrompt.length} characters ***`);
        console.log(`*** generalEnhancer: Sending request to model... ***`);
        
        let res = await model.sendRequest(turns, optimizedSystemPrompt, stop_seq);
        
        console.log(`*** generalEnhancer: sendRequest result received (length: ${res ? res.length : 0} characters) ***`);
        return res;
    }
    
    async sendVisionRequest(model, messages, systemMessage, imageBuffer) {
        console.log("*** generalEnhancer: sendVisionRequest called ***");
        console.log(`*** generalEnhancer: Number of messages: ${messages ? messages.length : 0} ***`);
        
        // Find the request type through semantic comparisons
        const requestType = await this.detectRequestType(messages, this.clusterTextLength);
        
        console.log(`*** generalEnhancer: ${requestType} request detected in vision request - optimizing system message ***`);
        let optimizedSystemMessage = this.optimizeSystemPrompt(requestType, systemMessage);

        let res = await model.sendVisionRequest(messages, optimizedSystemMessage, imageBuffer);
        console.log(`*** generalEnhancer: sendVisionRequest result received ***`);
        return res;
    }
}
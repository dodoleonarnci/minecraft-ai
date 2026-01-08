import { Enhancer } from './enhancer.js';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cosineSimilarity } from '../../utils/math.js';
import { env, pipeline } from '@xenova/transformers';
import { logConversation } from '../../utils/logger.js';
import { getCommand } from '../../agent/commands/index.js';
import { actionsList } from '../../agent/commands/actions.js';
import { queryList } from '../../agent/commands/queries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SoftClusteringEnhancer extends Enhancer {
    constructor(config, agent) {
        super(config);
        this.agent = agent;
        this.contextDir = path.resolve(__dirname, './contexts');

        // Same categories as ClusteringEnhancer
        this.categoryBase = {
            "building": "Let's build a house! I will build a church with oak planks and cobblestone. Let's light up this platform with torches. I ran out of wood, finding oak logs. Max, you build the walls, and I'll get started with the interior furniture.",
            "crafting": "Do you have any sticks? Oh, let me check my inventory to see if I have enought ingots. Let's find a crafting table. I have enough sticks to craft three diamond pickaxes, but do you have any diamonds. I only have eight planks, how many do you have? We need 6 sticks and 9 cobblestones. I can use this furnace and my coal to cook my raw beef. Do we have enough eggs? Is there enought iron ingots for this armor? Let's cook some more food.",
            "traveling": "I'm going to the other player. Follow me. Let's travel to the nether. Gonna head back to our base. Searching for wood logs right now. I can't find any ores nearby. Looking for some chickens. Heading to the coordinates you gave me.",
            "hunting": "Let's hunt down these sheep. I have to kill a lot of zombies. I have a stone sword to kill these pigs for pork. Time to attack!",
            "conversing": "Hi, my name is Steve. Hey Lucy, I'm Max. What do you want to do right now? I'm so bored, let's go do something.",
            "collecting": "Let's mine some stone. Now with an iron pickaxe, I can find some ores to mine. Finding wood to chop down, getting some oak logs. Searching for sand to collect. I'm trying to find some flowers. Still need to collect some more wood."
        };

        this.categoryEmbeddings = {};
        this.commandEmbeddings = {};
        this.initialized = false;
        this.extractor = null;
        this.suppressGlobalDocs = true;

        // Configuration
        this.topK = config?.topK || 15; // Number of commands to include
        this.relevanceWeight = config?.relevanceWeight || 0.7; // Weight for relevance matrix
        this.semanticWeight = config?.semanticWeight || 0.3; // Weight for semantic similarity

        // Load relevance matrix from file
        const matrixPath = config?.matrixPath || path.join(__dirname, 'default_relevance_matrix.json');
        this.relevanceMatrix = this._loadMatrixFromFile(matrixPath);
    }

    /**
     * Load relevance matrix from a JSON file.
     * @param {string} filePath - Path to the matrix JSON file
     * @returns {Object} Matrix mapping command -> {category: score}
     */
    _loadMatrixFromFile(filePath) {
        try {
            const data = JSON.parse(readFileSync(filePath, 'utf8'));
            const categories = ['building', 'crafting', 'collecting', 'traveling', 'hunting', 'conversing'];

            // Support both table format and object format
            if (Array.isArray(data)) {
                console.log(`[SoftClusteringEnhancer] Loaded relevance matrix from ${filePath} (table format)`);
                return this._tableToMatrix(data, categories);
            } else {
                console.log(`[SoftClusteringEnhancer] Loaded relevance matrix from ${filePath} (object format)`);
                return data;
            }
        } catch (err) {
            console.error(`[SoftClusteringEnhancer] Failed to load matrix from ${filePath}:`, err.message);
            console.log(`[SoftClusteringEnhancer] Using empty matrix with default fallback (0.1)`);
            return {};
        }
    }

    /**
     * Convert tabular format to matrix object
     * @param {Array} table - Array of [command, ...scores]
     * @param {Array} categories - Category names in order
     * @returns {Object} Matrix mapping command -> {category: score}
     */
    _tableToMatrix(table, categories) {
        const matrix = {};
        for (const row of table) {
            const [command, ...scores] = row;
            matrix[command] = {};
            categories.forEach((category, i) => {
                matrix[command][category] = scores[i];
            });
        }
        return matrix;
    }


    /**
     * Get relevance score for a command-category pair
     * @param {string} command - Command name
     * @param {string} category - Category name
     * @returns {number} Relevance score (default 0.1 if not found)
     */
    getRelevance(command, category) {
        return this.relevanceMatrix[command]?.[category] || 0.1;
    }

    /**
     * Set relevance score for a command-category pair
     * @param {string} command - Command name
     * @param {string} category - Category name
     * @param {number} score - Relevance score (0-1)
     */
    setRelevance(command, category, score) {
        if (!this.relevanceMatrix[command]) {
            this.relevanceMatrix[command] = {};
        }
        this.relevanceMatrix[command][category] = score;
    }

    /**
     * Export current matrix to file
     * @param {string} filePath - Path to save matrix
     * @param {string} format - 'table' or 'object'
     */
    exportMatrix(filePath, format = 'table') {
        const categories = ['building', 'crafting', 'collecting', 'traveling', 'hunting', 'conversing'];

        let data;
        if (format === 'table') {
            data = Object.entries(this.relevanceMatrix).map(([command, scores]) => {
                return [command, ...categories.map(cat => scores[cat] || 0.1)];
            });
        } else {
            data = this.relevanceMatrix;
        }

        writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`[SoftClusteringEnhancer] Exported matrix to ${filePath}`);
    }

    async init() {
        if (this.initialized) return;

        console.log('[SoftClusteringEnhancer] Initializing local embedding model (Xenova/all-MiniLM-L6-v2)...');
        env.localModelPath = './';
        env.allowRemoteModels = false;
        try {
            // Initialize the pipeline with local model
            this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

            // Compute category embeddings
            const categoryPromises = Object.entries(this.categoryBase).map(async ([category, text]) => {
                const output = await this.extractor(text, { pooling: 'mean', normalize: true });
                this.categoryEmbeddings[category] = output.data;
            });
            await Promise.all(categoryPromises);

            // Compute command embeddings for all commands
            const allCommands = [...actionsList, ...queryList];
            const commandPromises = allCommands.map(async (command) => {
                if (command.name && command.description) {
                    const text = `${command.name} ${command.description}`;
                    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
                    this.commandEmbeddings[command.name] = output.data;
                }
            });
            await Promise.all(commandPromises);

            this.initialized = true;
            console.log(`[SoftClusteringEnhancer] Initialized with ${Object.keys(this.commandEmbeddings).length} commands.`);
        } catch (err) {
            console.error('[SoftClusteringEnhancer] Failed to initialize embeddings:', err);
        }
    }

    async sendRequest(model, turns, systemPrompt, stop_seq = '***') {
        if (this.initialized) {
            try {
                const clusterText = this._getClusterText(turns);
                if (clusterText) {
                    const output = await this.extractor(clusterText, { pooling: 'mean', normalize: true });
                    const embedding = output.data;

                    // Find best matching category
                    let bestCategory = null;
                    let bestScore = -1;
                    const scores = {};

                    for (const [category, catEmbedding] of Object.entries(this.categoryEmbeddings)) {
                        const score = cosineSimilarity(embedding, catEmbedding);
                        scores[category] = score;
                        if (score > bestScore) {
                            bestScore = score;
                            bestCategory = category;
                        }
                    }

                    if (bestCategory) {
                        console.log(`[SoftClusteringEnhancer] Cluster Text: "${clusterText.replace(/\n/g, ' ')}"`);
                        console.log('[SoftClusteringEnhancer] Category Scores:');
                        for (const [cat, score] of Object.entries(scores)) {
                            console.log(`  - ${cat}: ${score.toFixed(4)}`);
                        }
                        console.log(`[SoftClusteringEnhancer] Selected Category: ${bestCategory} (score: ${bestScore.toFixed(4)})`);

                        if (this.agent && this.agent.bot) {
                            this.agent.bot.chat(`[SoftClusteringEnhancertering]: ${bestCategory} ${bestScore.toFixed(2)}`);
                        }

                        // Load generic instructions from context file
                        const contextFile = path.join(this.contextDir, `${bestCategory}.txt`);
                        let contextInstructions = '';
                        try {
                            contextInstructions = readFileSync(contextFile, 'utf8');
                        } catch (err) {
                            console.warn(`[SoftClusteringEnhancer] Context file not found for category: ${bestCategory}`);
                        }

                        // Select top-k commands using relevance matrix and semantic similarity
                        const selectedCommands = this._selectTopKCommands(bestCategory, embedding);

                        // Build custom command documentation
                        const commandDocs = this._buildCommandDocs(selectedCommands);

                        // Append to system prompt: context instructions + selected commands
                        systemPrompt += "\n\n" + contextInstructions;
                        systemPrompt += "\n\n" + commandDocs;

                        console.log(`[SoftClusteringEnhancer] Selected ${selectedCommands.length} commands for ${bestCategory}`);
                        console.log(`[SoftClusteringEnhancer] Top commands: ${selectedCommands.slice(0, 5).map(c => c.name).join(', ')}`);
                    }
                }
            } catch (err) {
                console.error('[SoftClusteringEnhancer] Error during clustering:', err);
            }
        }

        console.log('--- [SoftClusteringEnhancer] Final System Prompt ---');
        console.log(systemPrompt);
        console.log('-------------------------------------------------------');

        const response = await model.sendRequest(turns, systemPrompt, stop_seq);
        logConversation(turns, systemPrompt, response);
        return response;
    }

    _selectTopKCommands(category, messageEmbedding) {
        const allCommands = [...actionsList, ...queryList];
        const commandScores = [];

        for (const command of allCommands) {
            if (!command.name) continue;

            // Get relevance score from matrix using getter method
            const relevanceScore = this.getRelevance(command.name, category);

            // Get semantic similarity score
            let semanticScore = 0.0;
            if (this.commandEmbeddings[command.name]) {
                semanticScore = cosineSimilarity(messageEmbedding, this.commandEmbeddings[command.name]);
            }

            // Combine scores with weights
            const finalScore = (this.relevanceWeight * relevanceScore) + (this.semanticWeight * semanticScore);

            commandScores.push({
                command: command,
                name: command.name,
                relevanceScore: relevanceScore,
                semanticScore: semanticScore,
                finalScore: finalScore
            });
        }

        // Sort by final score (descending)
        commandScores.sort((a, b) => b.finalScore - a.finalScore);

        // Select top-k
        const topK = commandScores.slice(0, this.topK);

        // Log top commands for debugging
        console.log('[SoftClusteringEnhancer] Top command scores:');
        topK.slice(0, 10).forEach((item, idx) => {
            console.log(`  ${idx + 1}. ${item.name}: final=${item.finalScore.toFixed(3)} (rel=${item.relevanceScore.toFixed(2)}, sem=${item.semanticScore.toFixed(3)})`);
        });

        return topK.map(item => item.command);
    }

    _buildCommandDocs(commands) {
        const typeTranslations = {
            'float': 'number',
            'int': 'number',
            'BlockName': 'string',
            'ItemName': 'string',
            'boolean': 'bool'
        };

        let docs = `\n*SELECTED COMMAND DOCS\n You can use the following commands to perform actions and get information about the world.
    Use the commands with the syntax: !commandName or !commandName("arg1", 1.2, ...) if the command takes arguments.\n
    Do not use codeblocks. Use double quotes for strings. Only use one command in each response, trailing commands and comments will be ignored.\n`;

        for (let command of commands) {
            docs += command.name + ': ' + command.description + '\n';
            if (command.params) {
                docs += 'Params:\n';
                for (let param in command.params) {
                    docs += `${param}: (${typeTranslations[command.params[param].type] ?? command.params[param].type}) ${command.params[param].description}\n`;
                }
            }
        }

        return docs + '*\n';
    }

    _getClusterText(turns) {
        let clusterText = "";

        // Iterate backwards to find the most recent message
        for (let i = turns.length - 1; i >= 0; i--) {
            const turn = turns[i];
            const message = turn.content;

            if (turn.role === 'assistant') {
                clusterText = message;
                break;
            } else if (turn.role === 'user') {
                if (message.includes("FROM OTHER BOT")) {
                    const messageStart = message.indexOf("FROM OTHER BOT") + 15;
                    clusterText = message.substring(messageStart);
                } else {
                    clusterText = message;
                }
                break;
            }
        }
        return clusterText.trim();
    }
}

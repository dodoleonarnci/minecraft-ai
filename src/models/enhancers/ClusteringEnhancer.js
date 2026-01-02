import { Enhancer } from './enhancer.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cosineSimilarity } from '../../utils/math.js';
import { env, pipeline } from '@xenova/transformers';
import { logConversation } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ClusteringEnhancer extends Enhancer {
    constructor(config, agent) {
        super(config);
        this.agent = agent;
        this.contextDir = path.resolve(__dirname, './contexts');
        this.categoryBase = {
            "building": "Let's build a house! I will build a church with oak planks and cobblestone. Let's light up this platform with torches. I ran out of wood, finding oak logs. Max, you build the walls, and I'll get started with the interior furniture.",
            "crafting": "Do you have any sticks? Oh, let me check my inventory to see if I have enought ingots. Let's find a crafting table. I have enough sticks to craft three diamond pickaxes, but do you have any diamonds. I only have eight planks, how many do you have? We need 6 sticks and 9 cobblestones. I can use this furnace and my coal to cook my raw beef. Do we have enough eggs? Is there enought iron ingots for this armor? Let's cook some more food.",
            "traveling": "I'm going to the other player. Follow me. Let's travel to the nether. Gonna head back to our base. Searching for wood logs right now. I can't find any ores nearby. Looking for some chickens. Heading to the coordinates you gave me.",
            "hunting": "Let's hunt down these sheep. I have to kill a lot of zombies. I have a stone sword to kill these pigs for pork. Time to attack!",
            "conversing": "Hi, my name is Steve. Hey Lucy, I'm Max. What do you want to do right now? I'm so bored, let's go do something.",
            "collecting": "Let's mine some stone. Now with an iron pickaxe, I can find some ores to mine. Finding wood to chop down, getting some oak logs. Searching for sand to collect. I'm trying to find some flowers. Still need to collect some more wood."
        };
        this.categoryEmbeddings = {};
        this.initialized = false;
        this.extractor = null;
        this.suppressGlobalDocs = true;
    }

    async init() {
        if (this.initialized) return;

        console.log('[ClusteringEnhancer] Initializing local embedding model (Xenova/all-MiniLM-L6-v2)...');
        env.localModelPath = './';
        env.allowRemoteModels = false;
        try {
            // Initialize the pipeline with local model
            // Use just the model name (it will look in localModelPath)
            this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

            const promises = Object.entries(this.categoryBase).map(async ([category, text]) => {
                const output = await this.extractor(text, { pooling: 'mean', normalize: true });
                this.categoryEmbeddings[category] = output.data;
            });
            await Promise.all(promises);
            this.initialized = true;
            console.log('[ClusteringEnhancer] Initialized with local model.');
        } catch (err) {
            console.error('[ClusteringEnhancer] Failed to initialize embeddings:', err);
        }
    }

    async sendRequest(model, turns, systemPrompt, stop_seq = '***') {
        if (this.initialized) {
            try {
                const clusterText = this._getClusterText(turns);
                if (clusterText) {
                    const output = await this.extractor(clusterText, { pooling: 'mean', normalize: true });
                    const embedding = output.data;

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
                        console.log(`[ClusteringEnhancer] Cluster Text: "${clusterText.replace(/\n/g, ' ')}"`);
                        console.log('[ClusteringEnhancer] Category Scores:');
                        for (const [cat, score] of Object.entries(scores)) {
                            console.log(`  - ${cat}: ${score.toFixed(4)}`);
                        }
                        console.log(`[ClusteringEnhancer] Selected Category: ${bestCategory} (score: ${bestScore.toFixed(4)})`);

                        if (this.agent && this.agent.bot) {
                            this.agent.bot.chat(`[Clustering]: ${bestCategory} ${bestScore.toFixed(2)}`);
                        }

                        const contextFile = path.join(this.contextDir, `${bestCategory}.txt`);
                        try {
                            const context = readFileSync(contextFile, 'utf8');
                            systemPrompt += "\n\n" + context;
                        } catch (err) {
                            console.warn(`[ClusteringEnhancer] Context file not found for category: ${bestCategory}`);
                        }
                    }
                }
            } catch (err) {
                console.error('[ClusteringEnhancer] Error during clustering:', err);
            }
        }

        console.log('--- [ClusteringEnhancer] Final System Prompt ---');
        console.log(systemPrompt);
        console.log('------------------------------------------------');

        const response = await model.sendRequest(turns, systemPrompt, stop_seq);
        logConversation(turns, systemPrompt, response);
        return response;
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
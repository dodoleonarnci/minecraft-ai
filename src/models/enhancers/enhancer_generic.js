import { getKey, hasKey } from '../../utils/keys.js';
import { strictFormat } from '../../utils/text.js';

export class generalEnhancer {
    constructor(config) {
        this.config = config;
    }

    cosineSimilarity(vecA, vecB) {
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        return dotProduct / (normA * normB);
    }

    // Identify the type of request made by the user: "building", "crafting", "conversing", "traveling", "hunting", "collecting"
    async detectRequestType(turns, clusterTextLength) {        
        const fs = require('fs');
        const { pipeline } = require('@xenova/transformers');

        const categoryBase = {
        building: "Let's build a house! I will build a church with oak planks and cobblestone. Let's light up this platform with torches. I ran out of wood, finding oak logs. Max, you build the walls, and I'll get started with the interior furniture.",
        crafting: "Do you have any sticks? Oh, let me check my inventory to see if I have enought ingots. Let's find a crafting table. I have enough sticks to craft three diamond pickaxes, but do you have any diamonds. I only have eight planks, how many do you have? We need 6 sticks and 9 cobblestones. I can use this furnace and my coal to cook my raw beef. Do we have enough eggs? Is there enought iron ingots for this armor? Let's cook some more food.",
        traveling: "I'm going to the other player. Follow me. Let's travel to the nether. Gonna head back to our base. Searching for wood logs right now. I can't find any ores nearby. Looking for some chickens. Heading to the coordinates you gave me.",
        hunting: "Let's hunt down these sheep. I have to kill a lot of zombies. I have a stone sword to kill these pigs for pork. Time to attack!",
        conversing: "Hi, my name is Steve. Hey Lucy, I'm Max. What do you want to do right now? I'm so bored, let's go do something.",
        collecting: "Let's mine some stone. Now with an iron pickaxe, I can find some ores to mine. Finding wood to chop down, getting some oak logs. Searching for sand to collect. I'm trying to find some flowers. Still need to collect some more wood."
        };

        const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

        const rawData = fs.readFileSync('../../bots/Max/memory.json', 'utf8');
        const data = JSON.parse(rawData);

        const turns = data.turns;
        let iterator = turns.length - 1;
        let turnsAdded = 0;
        let clusterText = "";

        while (turnsAdded !== clusterTextLength && iterator > 0) {
            const message = turns[iterator].content;
            if (turns[iterator].role === 'assistant') {
            clusterText += message + "\n";
            turnsAdded++;
            } else if (turns[iterator].role === 'user') {
            if (message.includes("FROM OTHER BOT")) {
                const messageStart = message.indexOf("FROM OTHER BOT") + 15;
                clusterText += message.slice(messageStart) + "\n";
                turnsAdded++;
            }
            }
            iterator--;
        }

        console.log(clusterText + "\n***\n");

        const clusterEmbedding = await embedder(clusterText, { pooling: 'mean', normalize: true });
        const clusterVec = clusterEmbedding.data;
        let requestType = None
        let highestSimilarity = 0

        for (const [category, sampleText] of Object.entries(categoryBase)) {
            const categoryEmbedding = await embedder(sampleText, { pooling: 'mean', normalize: true });
            const categoryVec = categoryEmbedding.data;

            const sim = cosineSimilarity(categoryVec, clusterVec);
            if (sim>highestSimilarity) {
                requestType = category
                highestSimilarity = sim
            }
        }
        console.log(`The agent is ${requestType} with confidence ${sim.toFixed(4)}`);
        return requestType
    }

    // Optimize system prompt for the specific task
    optimizeSystemPrompt(requestType, originalSystemPrompt) {
        // TODODO: read from .txt file to get promptOptimizations
        promptOptimizations = "";
        // reduce original prompt's COMMAND_DOCS
        // reduce STATS
        // edit prompt to encourage inventory inspection and utilization
        return originalSystemPrompt + promptOptimizations;
    }

    async sendRequest(model, turns, systemPrompt, stop_seq='***') {
        console.log("*** MCAIEnhancer sendRequest called *** :", turns, "\n\n", systemPrompt);
        
        // Find the request type through semantic comparisons
        const requestType = this.detectRequestType(turns, systemPrompt);
        
        // Optimize systemPrompt according to request type
        console.log("*** " + requestType + " request detected - optimizing system prompt ***");
        let optimizedSystemPrompt = optimizeSystemPrompt(requestType, systemPrompt);
        let res = await model.sendRequest(turns, optimizedSystemPrompt, stop_seq);
        console.log("*** MCAIEnhancer sendRequest result *** :", res);
        return res;
    }
    
    async sendVisionRequest(model, messages, systemMessage, imageBuffer) {
        // Could also add house building detection here if needed
        const requestType = this.detectRequestType(turns, systemPrompt);
        let optimizedSystemMessage = systemMessage;
        console.log("*** " + requestType + "House building request detected in vision request - optimizing system message ***");
        optimizedSystemMessage = this.optimizeSystemPrompt(requestType, systemMessage);

        let res = await model.sendVisionRequest(messages, optimizedSystemMessage, imageBuffer);
        return res;
    }
}
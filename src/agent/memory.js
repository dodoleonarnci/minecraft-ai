import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import settings from '../../settings.js';


export class Memory {
    constructor(agent) {
        this.agent = agent;
        this.memory = '';
    }

    async get() {
        return this.memory;
    }

    set(content) {
        this.memory = content.raw;
    }

    async update(data) {
        this.memory = await this.agent.prompter.promptMemSaving(data.history);

        if (this.memory.length > 500) {
            this.memory = this.memory.slice(0, 500);
            this.memory += '...(Memory truncated to 500 chars. Compress it more next time)';
        }

        console.log("Memory updated to: ", this.memory);
    }

    clear() {
        this.memory = '';
    }
}
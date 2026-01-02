import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

export function logConversation(turns, systemPrompt, response) {
    const logDir = path.resolve('conversation');
    try {
        mkdirSync(logDir, { recursive: true });
    } catch (err) {
        console.error('Failed to create conversation log directory:', err);
        return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(logDir, `convo-${timestamp}.json`);

    const logData = {
        timestamp: new Date().toISOString(),
        systemPrompt: systemPrompt,
        turns: turns,
        response: response
    };

    try {
        writeFileSync(filename, JSON.stringify(logData, null, 4));
        console.log(`[Logger] Saved conversation to ${filename}`);
    } catch (err) {
        console.error('Failed to write conversation log:', err);
    }
}
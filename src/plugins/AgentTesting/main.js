import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { executeCommand } from '../../agent/commands/index.js';
import * as world from '../../agent/library/world.js';

export class PluginInstance {
    constructor(agent) {
        this.agent = agent;
        this.currentTask = null;
        this.testStartTime = null;
        this.testEndTime = null;
        this.testActive = false;
        this.testResults = {};
        this.timeoutHandle = null;
        this.monitoringInterval = null;
        this.availableTasks = new Map();
        this.resultsDir = `bots/${agent.name}/test_results`;
    }

    init() {
        console.log('[AgentTesting] Initializing plugin...');

        // Create results directory if it doesn't exist
        if (!existsSync(this.resultsDir)) {
            mkdirSync(this.resultsDir, { recursive: true });
        }

        // Load all available tasks from the tasks directory
        this.loadAvailableTasks();

        // Check if agent profile has a test configuration
        const profileTestConfig = this.agent.prompter.profile.test_config;
        if (profileTestConfig) {
            console.log('[AgentTesting] Found test configuration in agent profile');

            // Set up spawn event handler for automatic test initialization
            this.agent.bot.once('spawn', async () => {
                // Wait a bit for the world to load
                await new Promise(resolve => setTimeout(resolve, 2000));

                if (profileTestConfig.task_file) {
                    console.log(`[AgentTesting] Auto-loading task from ${profileTestConfig.task_file}`);
                    await this.loadTask(profileTestConfig.task_file);

                    if (profileTestConfig.auto_start && this.currentTask) {
                        console.log('[AgentTesting] Auto-starting test...');
                        await this.setupEnvironment();
                        await this.startTest();
                    }
                } else if (profileTestConfig.task_id) {
                    console.log(`[AgentTesting] Auto-loading task by ID: ${profileTestConfig.task_id}`);
                    await this.loadTaskById(profileTestConfig.task_id);

                    if (profileTestConfig.auto_start && this.currentTask) {
                        console.log('[AgentTesting] Auto-starting test...');
                        await this.setupEnvironment();
                        await this.startTest();
                    }
                }
            });
        }

        console.log('[AgentTesting] Plugin initialized successfully');
    }

    loadAvailableTasks() {
        const tasksDir = 'src/plugins/AgentTesting/tasks';

        try {
            if (!existsSync(tasksDir)) {
                console.log('[AgentTesting] Tasks directory does not exist, creating it...');
                mkdirSync(tasksDir, { recursive: true });
                return;
            }

            const files = readdirSync(tasksDir);
            for (const file of files) {
                if (file.endsWith('.json') && !file.startsWith('.')) {
                    try {
                        const taskPath = join(tasksDir, file);
                        const taskData = JSON.parse(readFileSync(taskPath, 'utf8'));
                        if (taskData.task_id) {
                            this.availableTasks.set(taskData.task_id, taskPath);
                            console.log(`[AgentTesting] Loaded task: ${taskData.task_id}`);
                        }
                    } catch (err) {
                        console.error(`[AgentTesting] Error loading task file ${file}:`, err.message);
                    }
                }
            }
            console.log(`[AgentTesting] Loaded ${this.availableTasks.size} task(s)`);
        } catch (err) {
            console.error('[AgentTesting] Error reading tasks directory:', err.message);
        }
    }

    async loadTask(taskFilePath) {
        try {
            console.log(`[AgentTesting] Loading task from: ${taskFilePath}`);

            // Resolve the path
            const resolvedPath = resolve(taskFilePath);

            if (!existsSync(resolvedPath)) {
                throw new Error(`Task file not found: ${resolvedPath}`);
            }

            const taskData = JSON.parse(readFileSync(resolvedPath, 'utf8'));

            // Validate required fields
            if (!taskData.task_id) {
                throw new Error('Task configuration missing required field: task_id');
            }
            if (!taskData.goal) {
                throw new Error('Task configuration missing required field: goal');
            }

            this.currentTask = taskData;
            console.log(`[AgentTesting] Successfully loaded task: ${taskData.task_id}`);
            console.log(`[AgentTesting] Task goal: ${taskData.goal}`);

            return true;
        } catch (err) {
            console.error('[AgentTesting] Error loading task:', err.message);
            return false;
        }
    }

    async loadTaskById(taskId) {
        if (this.availableTasks.has(taskId)) {
            const taskPath = this.availableTasks.get(taskId);
            return await this.loadTask(taskPath);
        } else {
            console.error(`[AgentTesting] Task ID not found: ${taskId}`);
            console.log(`[AgentTesting] Available tasks: ${Array.from(this.availableTasks.keys()).join(', ')}`);
            return false;
        }
    }

    async setupEnvironment() {
        if (!this.currentTask) {
            console.error('[AgentTesting] No task loaded. Cannot setup environment.');
            return false;
        }

        console.log('[AgentTesting] Setting up test environment...');
        const bot = this.agent.bot;
        const config = this.currentTask.test_config || {};

        try {
            // Wait a moment for the world to stabilize
            await new Promise(resolve => setTimeout(resolve, 500));

            // Enable cheat mode if configured
            if (config.enable_cheat_mode) {
                console.log('[AgentTesting] Enabling cheat mode...');
                bot.modes.setOn('cheat', true);
                // Give operator permissions if needed
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Clear inventory if configured
            if (config.reset_inventory) {
                console.log('[AgentTesting] Clearing inventory...');
                bot.chat('/clear @s');
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Teleport to starting coordinates if specified
            if (this.currentTask.teleport_coordinates) {
                const coords = this.currentTask.teleport_coordinates;
                console.log(`[AgentTesting] Teleporting to coordinates: ${coords.x}, ${coords.y}, ${coords.z}`);

                // Use cheat mode teleport or minecraft command
                bot.chat(`/tp @s ${coords.x} ${coords.y} ${coords.z}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Give starting inventory items if specified
            if (this.currentTask.starting_inventory) {
                console.log('[AgentTesting] Setting up starting inventory...');

                for (const [itemName, count] of Object.entries(this.currentTask.starting_inventory)) {
                    console.log(`[AgentTesting] Giving ${count} ${itemName}`);
                    bot.chat(`/give @s minecraft:${itemName} ${count}`);
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            console.log('[AgentTesting] Environment setup complete');
            return true;
        } catch (err) {
            console.error('[AgentTesting] Error setting up environment:', err.message);
            return false;
        }
    }

    async startTest() {
        if (!this.currentTask) {
            console.error('[AgentTesting] No task loaded. Cannot start test.');
            return false;
        }

        if (this.testActive) {
            console.error('[AgentTesting] Test is already active.');
            return false;
        }

        console.log(`[AgentTesting] Starting test: ${this.currentTask.task_id}`);

        this.testActive = true;
        this.testStartTime = Date.now();
        this.testResults = {
            task_id: this.currentTask.task_id,
            agent_name: this.agent.name,
            start_time: new Date(this.testStartTime).toISOString(),
            end_time: null,
            duration_seconds: null,
            success: false,
            termination_reason: null,
            initial_inventory: this.currentTask.starting_inventory || {},
            final_inventory: {},
            actions_taken: 0,
            goal: this.currentTask.goal
        };

        // Set up timeout if configured
        const config = this.currentTask.test_config || {};
        if (config.timeout_seconds) {
            console.log(`[AgentTesting] Setting timeout: ${config.timeout_seconds} seconds`);
            this.timeoutHandle = setTimeout(() => {
                console.log('[AgentTesting] Test timeout reached');
                this.endTest(false, 'timeout');
            }, config.timeout_seconds * 1000);
        }

        // Start monitoring for success criteria if specified
        if (config.success_criteria) {
            console.log('[AgentTesting] Starting success criteria monitoring...');
            this.startMonitoring();
        }

        // Send starting prompt to agent if specified
        if (this.currentTask.starting_prompt) {
            console.log('[AgentTesting] Sending starting prompt to agent...');
            await new Promise(resolve => setTimeout(resolve, 500));
            await this.agent.handleMessage('system', this.currentTask.starting_prompt);
        } else {
            // Use goal as the prompt
            console.log('[AgentTesting] Setting goal for agent...');
            await executeCommand(this.agent, `!goal("${this.currentTask.goal}")`);
        }

        console.log('[AgentTesting] Test started successfully');
        return true;
    }

    startMonitoring() {
        const config = this.currentTask.test_config || {};

        // Check success criteria every 5 seconds
        this.monitoringInterval = setInterval(() => {
            if (!this.testActive) {
                clearInterval(this.monitoringInterval);
                return;
            }

            const success = this.checkSuccessCriteria();
            if (success) {
                console.log('[AgentTesting] Success criteria met!');
                this.endTest(true, 'success_criteria_met');
            }
        }, 5000);
    }

    checkSuccessCriteria() {
        const config = this.currentTask.test_config || {};
        const criteria = config.success_criteria;

        if (!criteria) {
            return false;
        }

        // Check required items in inventory
        if (criteria.required_items) {
            const inventory = world.getInventoryCounts(this.agent.bot);

            for (const [itemName, requiredCount] of Object.entries(criteria.required_items)) {
                const actualCount = inventory[itemName] || 0;
                if (actualCount < requiredCount) {
                    return false;
                }
            }

            // All required items are present
            return true;
        }

        // Add more success criteria checks here as needed
        // e.g., position checks, entity checks, etc.

        return false;
    }

    async endTest(success = false, reason = 'manual') {
        if (!this.testActive) {
            console.log('[AgentTesting] No active test to end.');
            return;
        }

        console.log(`[AgentTesting] Ending test. Success: ${success}, Reason: ${reason}`);

        this.testActive = false;
        this.testEndTime = Date.now();

        // Clear timeout and monitoring
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;
        }
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        // Collect final results
        this.testResults.end_time = new Date(this.testEndTime).toISOString();
        this.testResults.duration_seconds = (this.testEndTime - this.testStartTime) / 1000;
        this.testResults.success = success;
        this.testResults.termination_reason = reason;
        this.testResults.final_inventory = world.getInventoryCounts(this.agent.bot);
        this.testResults.final_position = {
            x: this.agent.bot.entity.position.x,
            y: this.agent.bot.entity.position.y,
            z: this.agent.bot.entity.position.z
        };

        // Save results to file
        this.saveResults();

        // Send completion message to agent's memory (for evaluation_script.py compatibility)
        const code = success ? 2 : 4;
        const message = success ?
            `Task completed successfully! code : ${code}` :
            `Task failed. Reason: ${reason}. code : ${code}`;

        this.agent.history.add('system', message);
        this.agent.history.save();

        console.log('[AgentTesting] Test ended. Results saved.');

        return this.testResults;
    }

    saveResults() {
        try {
            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
            const filename = `${this.currentTask.task_id}_${timestamp}.json`;
            const filepath = join(this.resultsDir, filename);

            writeFileSync(filepath, JSON.stringify(this.testResults, null, 2));
            console.log(`[AgentTesting] Results saved to: ${filepath}`);

            // Also save as latest result for easy access
            const latestPath = join(this.resultsDir, 'latest.json');
            writeFileSync(latestPath, JSON.stringify(this.testResults, null, 2));

        } catch (err) {
            console.error('[AgentTesting] Error saving results:', err.message);
        }
    }

    getTaskStatus() {
        if (!this.currentTask) {
            return 'No task loaded';
        }

        if (this.testActive) {
            const elapsed = Math.floor((Date.now() - this.testStartTime) / 1000);
            const config = this.currentTask.test_config || {};
            const timeout = config.timeout_seconds || 'none';
            return `Active - ${this.currentTask.task_id} (${elapsed}s elapsed, timeout: ${timeout}s)`;
        }

        return `Loaded - ${this.currentTask.task_id} (not started)`;
    }

    listAvailableTasks() {
        if (this.availableTasks.size === 0) {
            return 'No tasks available';
        }

        const tasks = Array.from(this.availableTasks.keys());
        return `Available tasks (${tasks.length}):\n${tasks.map(t => `- ${t}`).join('\n')}`;
    }

    getPluginActions() {
        return [
            {
                name: '!loadTestTask',
                description: 'Load a test task by ID or file path. Use !listTestTasks to see available tasks.',
                params: {
                    'task_identifier': {
                        type: 'string',
                        description: 'Task ID (from available tasks) or file path to task JSON file'
                    }
                },
                perform: async (agent, task_identifier) => {
                    const plugin = agent.plugin.plugins["AgentTesting"];

                    // Try loading by ID first
                    if (plugin.availableTasks.has(task_identifier)) {
                        const success = await plugin.loadTaskById(task_identifier);
                        if (success) {
                            agent.bot.chat(`Loaded test task: ${task_identifier}`);
                        } else {
                            agent.bot.chat(`Failed to load task: ${task_identifier}`);
                        }
                    } else {
                        // Try loading by file path
                        const success = await plugin.loadTask(task_identifier);
                        if (success) {
                            agent.bot.chat(`Loaded test task from file`);
                        } else {
                            agent.bot.chat(`Failed to load task from file: ${task_identifier}`);
                        }
                    }
                }
            },
            {
                name: '!setupTestEnvironment',
                description: 'Set up the test environment (teleport, inventory, etc.) for the loaded task.',
                params: {},
                perform: async (agent) => {
                    const plugin = agent.plugin.plugins["AgentTesting"];
                    const success = await plugin.setupEnvironment();
                    if (success) {
                        agent.bot.chat('Test environment setup complete');
                    } else {
                        agent.bot.chat('Failed to setup test environment');
                    }
                }
            },
            {
                name: '!startTest',
                description: 'Start the loaded test task.',
                params: {},
                perform: async (agent) => {
                    const plugin = agent.plugin.plugins["AgentTesting"];
                    const success = await plugin.startTest();
                    if (!success) {
                        agent.bot.chat('Failed to start test');
                    }
                }
            },
            {
                name: '!endTest',
                description: 'Manually end the current test.',
                params: {
                    'success': {
                        type: 'boolean',
                        description: 'Whether the test was successful'
                    }
                },
                perform: async (agent, success = false) => {
                    const plugin = agent.plugin.plugins["AgentTesting"];
                    await plugin.endTest(success, 'manual');
                    agent.bot.chat('Test ended');
                }
            },
            {
                name: '!testStatus',
                description: 'Get the current test status.',
                params: {},
                perform: async (agent) => {
                    const plugin = agent.plugin.plugins["AgentTesting"];
                    const status = plugin.getTaskStatus();
                    agent.bot.chat(`Test status: ${status}`);
                    return status;
                }
            },
            {
                name: '!listTestTasks',
                description: 'List all available test tasks.',
                params: {},
                perform: async (agent) => {
                    const plugin = agent.plugin.plugins["AgentTesting"];
                    const list = plugin.listAvailableTasks();
                    console.log(list);
                    agent.bot.chat(`Check console for task list`);
                    return list;
                }
            },
            {
                name: '!quickTest',
                description: 'Quick test command - loads, sets up, and starts a test task in one command.',
                params: {
                    'task_identifier': {
                        type: 'string',
                        description: 'Task ID or file path'
                    }
                },
                perform: async (agent, task_identifier) => {
                    const plugin = agent.plugin.plugins["AgentTesting"];

                    // Load task
                    let success;
                    if (plugin.availableTasks.has(task_identifier)) {
                        success = await plugin.loadTaskById(task_identifier);
                    } else {
                        success = await plugin.loadTask(task_identifier);
                    }

                    if (!success) {
                        agent.bot.chat(`Failed to load task: ${task_identifier}`);
                        return;
                    }

                    // Setup environment
                    success = await plugin.setupEnvironment();
                    if (!success) {
                        agent.bot.chat('Failed to setup environment');
                        return;
                    }

                    // Start test
                    success = await plugin.startTest();
                    if (!success) {
                        agent.bot.chat('Failed to start test');
                        return;
                    }

                    agent.bot.chat(`Quick test started: ${task_identifier}`);
                }
            }
        ];
    }
}

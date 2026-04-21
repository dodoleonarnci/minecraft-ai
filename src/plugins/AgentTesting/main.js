import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { executeCommand } from '../../agent/commands/index.js';
import * as world from '../../agent/library/world.js';

// Load world config once at module level — user sets surface_y for their world
const WORLD_CONFIG_PATH = 'src/plugins/AgentTesting/world_config.json';
let _worldConfig = null;
function getWorldConfig() {
    if (!_worldConfig) {
        try {
            _worldConfig = JSON.parse(readFileSync(WORLD_CONFIG_PATH, 'utf8'));
        } catch (err) {
            _worldConfig = {};
        }
    }
    return _worldConfig;
}

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

        // Batch mode state (T4.7)
        this.batchQueue = null;
        this.batchResults = [];
        this.batchStartTime = null;
        this.batchFilter = 'all';

        // Telemetry state (T4.6)
        this._telemetryTimeline = [];
        this._telemetryListener = null;
        this._telemetryStartTime = null;
        this._telemetryInterval = null;

        // Death listener state (T4.5)
        this._agentDied = false;
        this._deathHandler = null;
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

                // Batch mode auto-start (T4.7) takes precedence over single-task auto-start
                if (profileTestConfig.batch && profileTestConfig.auto_start) {
                    console.log('[AgentTesting] Auto-starting batch test...');
                    await this.runBatch(profileTestConfig.batch_filter || 'all');
                    return;
                }

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

        // Cache of full task data by id, used for category filtering in batch mode
        this.taskDataCache = new Map();

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
                            this.taskDataCache.set(taskData.task_id, taskData);
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

            // Disable any modes listed in the task's disabled_modes array.
            // Snapshot the current state so endTest() can restore them.
            this._disabledModes = [];
            if (config.disabled_modes && Array.isArray(config.disabled_modes)) {
                for (const modeName of config.disabled_modes) {
                    try {
                        const wasOn = bot.modes.isOn(modeName);
                        bot.modes.setOn(modeName, false);
                        this._disabledModes.push({ name: modeName, wasOn });
                        console.log(`[AgentTesting] Disabled mode: ${modeName}`);
                    } catch (e) {
                        console.warn(`[AgentTesting] Unknown mode "${modeName}", skipping`);
                    }
                }
            }

            // Always restore full health and hunger before each task.
            // This gives every task a clean physiological baseline.
            // Survival-critical tasks re-apply damage/hunger via setup_commands after this.
            console.log('[AgentTesting] Restoring full health and hunger...');
            bot.chat('/effect clear @s');
            await new Promise(resolve => setTimeout(resolve, 200));
            // Instant Health amplifier 4 = ~32 HP restored (more than the 20 HP max)
            bot.chat('/effect give @s minecraft:instant_health 1 4');
            await new Promise(resolve => setTimeout(resolve, 200));
            // Saturation fills the hunger bar; amplifier 255 for 5 seconds saturates fully
            bot.chat('/effect give @s minecraft:saturation 5 255');
            await new Promise(resolve => setTimeout(resolve, 500));

            // Clear inventory if configured
            if (config.reset_inventory) {
                console.log('[AgentTesting] Clearing inventory...');
                bot.chat('/clear @s');
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Teleport to starting coordinates if specified
            if (this.currentTask.teleport_coordinates) {
                const coords = this.currentTask.teleport_coordinates;
                // Use world_config.json surface_y if set, otherwise fall back to task y
                const cfg = getWorldConfig();
                const y = (cfg.surface_y != null) ? cfg.surface_y : coords.y;
                console.log(`[AgentTesting] Teleporting to: ${coords.x}, ${y}, ${coords.z}` +
                    (cfg.surface_y != null ? ` (y overridden by world_config.json)` : ''));
                bot.chat(`/tp @s ${coords.x} ${y} ${coords.z}`);
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

            // Run any extra setup commands (T4.1: survival-critical task support).
            // These run after teleport + inventory so effects/damage land on the
            // already-positioned, already-stocked agent.
            if (config.setup_commands && Array.isArray(config.setup_commands)) {
                console.log(`[AgentTesting] Running ${config.setup_commands.length} setup command(s)...`);
                for (const cmd of config.setup_commands) {
                    console.log(`[AgentTesting] Setup command: ${cmd}`);
                    bot.chat(cmd);
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

        // Reset conversation history + memory so each task starts from a clean
        // slate (no leftover turns, summary, or memory bank entries from prior tests).
        if (this.agent.history && typeof this.agent.history.clear === 'function') {
            console.log('[AgentTesting] Clearing agent history and memory...');
            this.agent.history.clear();
        }

        this.testActive = true;
        this.testStartTime = Date.now();

        // --- T4.5: reset all instrumentation counters on the shared objects ---
        this.agent._actionCount = 0;
        this.agent._hallucinationCount = 0;
        this.agent._outOfSetCount = 0;
        if (this.agent.prompter && this.agent.prompter.chat_model) {
            this.agent.prompter.chat_model._totalTokens = 0;
        }
        // Clear stale enhancer state from any previous test
        if (this.agent.prompter && this.agent.prompter.enhancer) {
            this.agent.prompter.enhancer._lastCategory = null;
        }

        // --- T4.5: death listener owned by the plugin ---
        this._agentDied = false;
        this._deathHandler = () => { this._agentDied = true; };
        this.agent.bot.on('death', this._deathHandler);

        // --- T4.6: telemetry timeline ---
        this._telemetryTimeline = [];
        this._telemetryStartTime = Date.now();
        this._startTelemetry();

        this.testResults = {
            task_id: this.currentTask.task_id,
            agent_name: this.agent.name,
            category: this.currentTask.category || 'unknown',
            survival_critical: this.currentTask.survival_critical || false,
            start_time: new Date(this.testStartTime).toISOString(),
            end_time: null,
            duration_seconds: null,
            success: false,
            termination_reason: null,
            initial_inventory: this.currentTask.starting_inventory || {},
            final_inventory: {},
            actions_taken: 0,
            hallucination_count: 0,
            agent_died: false,
            token_count: 0,
            detected_category: null,
            out_of_set_commands: 0,
            telemetry_timeline: [],
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

        // Check required items in inventory (min count, inclusive)
        // and/or max_items (ceiling count, inclusive). Both can be combined;
        // the task succeeds only if every listed item passes its check.
        if (criteria.required_items || criteria.max_items) {
            const inventory = world.getInventoryCounts(this.agent.bot);

            if (criteria.required_items) {
                for (const [itemName, requiredCount] of Object.entries(criteria.required_items)) {
                    const actualCount = inventory[itemName] || 0;
                    if (actualCount < requiredCount) {
                        return false;
                    }
                }
            }

            if (criteria.max_items) {
                for (const [itemName, maxCount] of Object.entries(criteria.max_items)) {
                    const actualCount = inventory[itemName] || 0;
                    if (actualCount > maxCount) {
                        return false;
                    }
                }
            }

            return true;
        }

        // Conversing-style criteria (T4.1): verify the agent has executed at least
        // one action (any command) since startTest() reset the counter. Used for
        // chat-based tasks where the goal is "respond / report" rather than
        // collecting an item.
        if (criteria.min_actions != null) {
            return (this.agent._actionCount || 0) >= criteria.min_actions;
        }

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

        // Stop telemetry collection (T4.6)
        this._stopTelemetry();

        // Restore any modes that were disabled for this task
        if (this._disabledModes && this._disabledModes.length > 0) {
            for (const { name, wasOn } of this._disabledModes) {
                try {
                    this.agent.bot.modes.setOn(name, wasOn);
                    console.log(`[AgentTesting] Restored mode: ${name} -> ${wasOn}`);
                } catch (e) { /* ignore */ }
            }
            this._disabledModes = [];
        }

        // Detach death listener (T4.5)
        if (this._deathHandler) {
            try {
                this.agent.bot.removeListener('death', this._deathHandler);
            } catch (err) { /* ignore */ }
            this._deathHandler = null;
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

        // T4.5: collect instrumentation data from shared state
        this.testResults.actions_taken = this.agent._actionCount || 0;
        this.testResults.hallucination_count = this.agent._hallucinationCount || 0;
        this.testResults.out_of_set_commands = this.agent._outOfSetCount || 0;
        this.testResults.agent_died = this._agentDied || false;
        this.testResults.token_count = this.agent.prompter?.chat_model?._totalTokens || 0;
        this.testResults.detected_category = this.agent.prompter?.enhancer?._lastCategory || null;
        this.testResults.telemetry_timeline = this._telemetryTimeline.slice();

        // Save results to file
        this.saveResults();

        // Send completion message to agent's memory (for evaluation_script.py compatibility)
        const code = success ? 2 : 4;
        const message = success ?
            `Task completed successfully! code : ${code}` :
            `Task failed. Reason: ${reason}. code : ${code}`;

        this.agent.history.add('system', message);
        this.agent.history.save();

        // Broadcast result to in-game chat so it's visible without reading logs
        const duration = this.testResults.duration_seconds?.toFixed(1) ?? '?';
        const chatMsg = success
            ? `[AgentTesting] PASS: ${this.testResults.task_id} (${duration}s, ${this.testResults.actions_taken} actions)`
            : `[AgentTesting] FAIL: ${this.testResults.task_id} — ${reason} (${duration}s)`;
        try { this.agent.bot.chat(chatMsg); } catch (e) {}

        console.log('[AgentTesting] Test ended. Results saved.');

        // Batch mode chaining (T4.7): if a batch is in progress, queue the next task
        if (this.batchQueue) {
            // Push a deep-copy snapshot so subsequent tests don't mutate it
            this.batchResults.push(JSON.parse(JSON.stringify(this.testResults)));
            // Brief pause for cleanup before launching the next task
            setTimeout(() => this._runNextInBatch(), 3000);
        }

        return this.testResults;
    }

    // ----- Telemetry helpers (T4.6) -----

    _startTelemetry() {
        const bot = this.agent.bot;
        if (!bot) return;

        const recordSample = (eventTag) => {
            try {
                const pos = bot.entity?.position;
                let distanceToGoal = null;
                if (pos && this.currentTask?.teleport_coordinates) {
                    const goal = this.currentTask.goal_coordinates || this.currentTask.teleport_coordinates;
                    const dx = pos.x - goal.x;
                    const dy = pos.y - goal.y;
                    const dz = pos.z - goal.z;
                    distanceToGoal = Math.sqrt(dx*dx + dy*dy + dz*dz);
                }
                this._telemetryTimeline.push({
                    timestep: (Date.now() - this._telemetryStartTime) / 1000,
                    event: eventTag,
                    health: bot.health ?? null,
                    food: bot.food ?? null,
                    oxygen: bot.oxygenLevel ?? null,
                    position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
                    distance_to_goal: distanceToGoal
                });
            } catch (err) {
                // swallow telemetry errors so they never break a test
            }
        };

        // Health-change event listener (mineflayer supports multiple listeners on the same event)
        this._telemetryListener = () => recordSample('health_change');
        bot.on('health', this._telemetryListener);

        // Periodic 1-second sampler ensures we capture data even when no health change occurs
        this._telemetryInterval = setInterval(() => recordSample('tick'), 1000);

        // Initial sample at t=0
        recordSample('start');
    }

    _stopTelemetry() {
        if (this._telemetryListener && this.agent.bot) {
            try {
                this.agent.bot.removeListener('health', this._telemetryListener);
            } catch (err) { /* ignore */ }
            this._telemetryListener = null;
        }
        if (this._telemetryInterval) {
            clearInterval(this._telemetryInterval);
            this._telemetryInterval = null;
        }
    }

    // ----- Batch mode (T4.7) -----

    async runBatch(filter = 'all') {
        // Build queue from availableTasks, optionally filtered by category
        const taskIds = Array.from(this.availableTasks.keys()).filter(id => {
            if (filter === 'all') return true;
            const task = this.taskDataCache.get(id);
            return task && task.category === filter;
        });

        if (taskIds.length === 0) {
            console.log('[AgentTesting] No tasks match filter:', filter);
            return;
        }

        this.batchQueue = [...taskIds];
        this.batchResults = [];
        this.batchStartTime = Date.now();
        this.batchFilter = filter;

        console.log(`[AgentTesting] Starting batch: ${taskIds.length} tasks (filter: ${filter})`);
        try { this.agent.bot.chat(`Starting batch test: ${taskIds.length} tasks`); } catch (e) {}
        await this._runNextInBatch();
    }

    async _runNextInBatch() {
        if (!this.batchQueue || this.batchQueue.length === 0) {
            this._saveBatchResults();
            return;
        }

        const taskId = this.batchQueue.shift();
        const completed = this.batchResults.length;
        const remaining = this.batchQueue.length;
        console.log(`[AgentTesting] Batch: starting task ${taskId} (${completed + 1}/${completed + remaining + 1})`);

        // Same sequence as !quickTest: load -> setup -> start
        const loaded = await this.loadTaskById(taskId);
        if (!loaded) {
            console.error(`[AgentTesting] Batch: failed to load ${taskId}, skipping`);
            this.batchResults.push({ task_id: taskId, success: false, termination_reason: 'load_failed' });
            setTimeout(() => this._runNextInBatch(), 1000);
            return;
        }

        const setup = await this.setupEnvironment();
        if (!setup) {
            this.batchResults.push({ task_id: taskId, success: false, termination_reason: 'setup_failed' });
            setTimeout(() => this._runNextInBatch(), 1000);
            return;
        }

        await this.startTest();
        // startTest returns immediately; endTest will be triggered by either
        // the success-criteria monitor or the timeout, then chain via batchQueue.
    }

    _saveBatchResults() {
        try {
            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
            const filename = `batch_${this.agent.name}_${timestamp}.json`;
            const filepath = join(this.resultsDir, filename);

            const successCount = this.batchResults.filter(r => r.success).length;
            const totalCount = this.batchResults.length;

            const batchReport = {
                experiment: this.agent.name,
                timestamp: new Date().toISOString(),
                config: {
                    profile_name: this.agent.prompter?.profile?.name || this.agent.name,
                    enhancer: this.agent.prompter?.enhancer?.constructor?.name || 'Enhancer',
                    enhancer_config: this.agent.prompter?.profile?.enhancer || null,
                    model: this.agent.prompter?.profile?.model || null,
                    filter: this.batchFilter,
                    total_tasks: totalCount
                },
                total_duration_seconds: (Date.now() - this.batchStartTime) / 1000,
                summary: {
                    success_count: successCount,
                    failure_count: totalCount - successCount,
                    success_rate: totalCount > 0 ? successCount / totalCount : 0,
                    mean_actions: totalCount > 0 ? this.batchResults.reduce((s, r) => s + (r.actions_taken || 0), 0) / totalCount : 0,
                    mean_hallucinations: totalCount > 0 ? this.batchResults.reduce((s, r) => s + (r.hallucination_count || 0), 0) / totalCount : 0,
                    mean_tokens: totalCount > 0 ? this.batchResults.reduce((s, r) => s + (r.token_count || 0), 0) / totalCount : 0
                },
                results: this.batchResults
            };

            writeFileSync(filepath, JSON.stringify(batchReport, null, 2));
            console.log(`[AgentTesting] Batch complete. ${successCount}/${totalCount} passed. Saved to: ${filepath}`);

            // Also save as latest_batch.json for the orchestration script
            const latestPath = join(this.resultsDir, 'latest_batch.json');
            writeFileSync(latestPath, JSON.stringify(batchReport, null, 2));

            try { this.agent.bot.chat(`Batch complete: ${successCount}/${totalCount} passed`); } catch (e) {}
        } catch (err) {
            console.error('[AgentTesting] Error saving batch results:', err.message);
        } finally {
            this.batchQueue = null;
        }
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
                name: '!batchTest',
                description: 'Run all tasks (or tasks of a given category) sequentially and save aggregate results.',
                params: {
                    'filter': {
                        type: 'string',
                        description: '"all" or a category name (building, crafting, collecting, traveling, hunting, conversing)'
                    }
                },
                perform: async (agent, filter) => {
                    const plugin = agent.plugin.plugins["AgentTesting"];
                    await plugin.runBatch(filter || 'all');
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

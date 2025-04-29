import { Vec3 } from 'vec3';
import { readdirSync, readFileSync } from 'fs';
import { ItemGoal } from '../npc/item_goal.js';
import { itemSatisfied, blockSatisfied, getTypeOfGeneric, rotateXZ} from '../npc/utils.js';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';

class BuildGoal {
    constructor(agent) {
        this.agent = agent;
    }

    async executeNext(blueprint, built) {
        let position = built.position
        let missing = {};
        let finished = false;
        let failed = false;
        let error = null;

        if (!position) {
            let [min_x, max_x, min_z, max_z] = [0, 0, 0, 0];
            for (let block of blueprint.blocks) {
                if (block[1] !== 0) continue;
                min_x = Math.min(min_x, block[0]);    
                max_x = Math.min(max_x, block[0]);    
                min_z = Math.min(min_z, block[0]);    
                max_z = Math.min(max_z, block[0]);    
            }

            let size = Math.max(max_x - min_x, max_z - min_z);
            position = world.getNearestFreeSpace(this.agent.bot, size, 32);
        }

        if (!position) {
            failed = true; 
            error = `I can't find a free space to build ${goal.name}.`;
        } else {
            let inventory = world.getInventoryCounts(this.agent.bot);
            let satisfied = 0;
            let added = 0;
            for (let block of blueprint.blocks) {
                try {
                    let block_name = block[3];
                    if (block_name === null || block_name === '') continue;
                    const world_pos = new Vec3(position.x + block[0], position.y + block[1], position.z + block[2]);
                    let current_block = this.agent.bot.blockAt(world_pos);

                    if (current_block !== null) {
                        if (blockSatisfied(block_name, current_block)) {
                            satisfied++;
                            continue;
                        } 
                        
                        if (current_block.name !== 'air') {
                            console.log("Need to break block: ", current_block.name)
                            let res = await this.agent.actions.runAction('build:BuildGoal', async () => {
                                await skills.breakBlockAt(this.agent.bot, world_pos.x, world_pos.y, world_pos.z);
                            })
                            if (!res) {
                                failed = true;
                                error = `Interupted in breaking block ${block_name} at ${world_pos.x}, ${world_pos.y}, ${world_pos.z}`;
                                break;
                            }
                        }

                        console.log("Place block: ", block_name)
                        let block_typed = getTypeOfGeneric(this.agent.bot, block_name);
                        if (inventory[block_typed] > 0) {
                            let res = await this.agent.actions.runAction('build:BuildGoal', async () => {
                                await skills.placeBlock(this.agent.bot, block_typed, world_pos.x, world_pos.y, world_pos.z);
                            })
                            if (!res) {
                                failed = true;
                                error = `Interupted when placing ${block_name} at ${world_pos.x}, ${world_pos.y}, ${world_pos.z}`;
                                break;
                            }
                        } else {
                            if (missing[block_typed] === undefined)
                                missing[block_typed] = 0;
                            missing[block_typed]++;
                        }

                        current_block = this.agent.bot.blockAt(world_pos);
                        if (blockSatisfied(block_name, current_block)) {
                            added++;
                        }
                    }
                } catch (e) {
                    console.log(`Error in placing ${block[3]} at ${world_pos.x}, ${world_pos.y}, ${world_pos.z}: `, e);
                    continue
                }
            }
            if (satisfied === blueprint.blocks.length) {
                finished = true;
            } else if (added < 1 && Object.keys(missing).length < 1) {
                failed = true;
                error = `I can't finish building the complete version of ${blueprint.name}.`;
            }
        }

        return {position, finished, missing, failed, error};
    }

}
export class BuildManager {
    constructor(agent) {
        this.agent = agent;
        this.goals = [];
        this.blueprint = null;
        this.built = {};
        this.item_goal = new ItemGoal(agent);
        this.build_goal = new BuildGoal(agent);
        this.blueprints = {};
    }

    getBuiltPositions() {
        let positions = [];
        for (let name in this.built) {
            let position = this.built[name].position;
            let sizex = this.blueprints[name].blocks[0][0].length;
            let sizez = this.blueprints[name].blocks[0].length;
            let sizey = this.blueprints[name].blocks.length;
            for (let y = 0; y < sizey; y++) {
                for (let z = 0; z < sizez; z++) {
                    for (let x = 0; x < sizex; x++) {
                        positions.push({x: position.x + x, y: position.y + y, z: position.z + z});
                    }
                }
            }
        }
        return positions;
    }

    init() {
        try {
            for (let file of readdirSync('src/agent/build/blueprints/')) {
                if (file.endsWith('.json') && !file.startsWith('.')) {
                    this.blueprints[file.slice(0, -5)] = JSON.parse(readFileSync('src/agent/build/blueprints/' + file, 'utf8'));
                }
            }
        } catch (e) {
            console.log('Error reading blueprint file');
        }

        this.agent.bot.on('idle', async () => {
            if (!this.agent.isIdle() || this.goals.length < 1) return;
            // Wait a while for inputs before acting independently
            await new Promise((resolve) => setTimeout(resolve, 5000));
            // Persue goal
            if (!this.agent.actions.resume_func) {
                this.executeNext();
                this.agent.history.save();
            }
        });
    }

    async setGoal(name, quantity=1, blueprint=null) {
        this.stop();
        if (name) {
            let goal = {name: name, quantity: quantity};
            if (blueprint)
                this.blueprint = blueprint;
            else if (this.blueprints[name] !== undefined)
                this.blueprint = this.blueprints[name];
            
            this.blueprint.blocks.sort((a, b) => {a[1] - b[1]});
            this.goals.push(goal);
            console.log('Set new building goal: ', name, ' x', quantity, ' with blueprint: ', this.blueprint);
            this.agent.bot.emit('idle');
        }
    }

    async executeNext() {
        if (!this.agent.isIdle() || this.goals.length < 1) return;

        await this.agent.actions.runAction('build:moveAway', async () => {
            await skills.moveAway(this.agent.bot, 2);
        });
        
        let door_pos = this.getCurrentBuildingDoor();
        if (door_pos) {
            await this.agent.actions.runAction('build:exitBuilding', async () => {
                await skills.useDoor(this.agent.bot, door_pos);
                await skills.moveAway(this.agent.bot, 2); 
            });
        }

        // Work towards goals
        await this.executeGoal();

        if (this.agent.isIdle()) this.agent.bot.emit('idle');
    }
    
    inBuilding() {
        if (!this.blueprint || this.built.position === undefined) return false;
        let bot_pos = this.agent.bot.entity.position;
        let pos = this.built.position;
        let sizex = this.blueprint.blocks[0][0].length;
        let sizez = this.blueprint.blocks[0].length;
        let sizey = this.blueprint.blocks.length;
        if (bot_pos.x >= pos.x && bot_pos.x < pos.x + sizex &&
            bot_pos.y >= pos.y && bot_pos.y < pos.y + sizey &&
            bot_pos.z >= pos.z && bot_pos.z < pos.z + sizez) {
            return true;
        }
        return false;
    }

    getCurrentBuildingDoor() {
        if (!this.inBuilding) return null; 
        try {
            let door_x = null;
            let door_z = null;
            let door_y = null;
            for (let y = 0; y < this.blueprint.blocks.length; y++) {
                for (let z = 0; z < this.blueprint.blocks[y].length; z++) {
                    for (let x = 0; x < this.blueprint.blocks[y][z].length; x++) {
                        if (this.blueprint.blocks[y][z][x] !== null &&
                            this.blueprint.blocks[y][z][x].includes('door')) {
                            door_x = x;
                            door_z = z;
                            door_y = y;
                            break;
                        }
                    }
                    if (door_x !== null) break;
                }
                if (door_x !== null) break;
            }
            if (door_x === null) return null;

            return {
                x: this.built.position.x + door_x,
                y: this.built.position.y + door_y,
                z: this.built.position.z + door_z
            };
        } catch (e) {
            return null;
        }
    }

    async executeGoal() {
        console.log("Executing goals: ", this.goals);
        if (this.goals.length > 0) {
            let goal = this.goals[0];
            try {
                if (!this.blueprints[goal.name]) {
                    console.log(`Item goal: ${goal.name} x ${goal.quantity}.`);
                    if (this.agent.bot.game.gameMode === "creative") 
                        this.agent.bot.chat(`/give ${this.agent.name} ${goal.name} ${goal.quantity}`)
                        await new Promise((resolve) => setTimeout(resolve, 3000));
                    if (!itemSatisfied(this.agent.bot, goal.name, goal.quantity)) {
                        let res = await this.item_goal.executeNext(goal.name, goal.quantity);
                        if (!res) {
                            this.agent.bot.chat(`I can't build ${this.goals[-1].name}, as stuck when get ${goal.name} x ${goal.quantity}.`);
                            this.stop();
                        }
                    }
                    if (this.goals.length > 0) {
                        this.goals.shift();
                    }
                } else {
                    console.log(`Build goal: ${goal.name} x ${goal.quantity}.`);
                    let res = await this.build_goal.executeNext(this.blueprint, this.built)
                    for (let block_name in res.missing) {
                        this.goals.unshift({
                            name: block_name,
                            quantity: res.missing[block_name]
                        })
                    }

                    if (res.failed) {
                        this.agent.bot.chat(res.error);
                        this.stop();
                    } else {
                        this.built.position = res.position;
                    }

                    if (res.finished) {
                        if (this.goals.length > 0) {
                            this.goals.shift();
                        }
                    } 
                }
            } catch (e) {
                console.log("Error in executing building goal: ", e);
                this.agent.bot.chat(`I can't build ${goal.name} right now.`);
                this.stop();
            }
        }
        if (this.goals.length > 0) {
            this.agent.bot.emit("idle");
        } else {
            this.agent.bot.chat(`I finished the building.`);
            this.stop();
        }
    }

    async buildWithIdea(name, idea) {
        if (this.blueprints[name] === undefined) {
            console.log(`Can't find reference blueprint: ${name}.`);
            return 
        }
        console.log("Building with idea: ", name, idea)
        let blueprint = await this.agent.prompter.promptBuilding(this.blueprints[name], idea);
        if (blueprint.blocks !== undefined && blueprint.blocks.length > 0) {
            console.log(`Generated blueprint to build with:\n${JSON.stringify(blueprint)}`);
            this.setGoal(name, 1, blueprint);
        } else {
            this.agent.bot.chat(`I got an invalid blueprint for ${name}: ${blueprint}`);
            console.log('Error in generating blueprint for building.');
        }
    }

    stop() {
        this.goals = [];
        this.blueprint = null;
        this.built = {};
    }
}
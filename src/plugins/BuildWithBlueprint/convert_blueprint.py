import json
source = "blueprints/church_two_agents.json" # the MINDcraft blueprint that you want to convert
target = "blueprints/church.json"
title = "church_two_agent"

with open(source, 'r') as file:
    data = json.load(file)
blueprint = data[title]["blueprint"]["levels"]

blocks = []
size = 10
offset = blueprint[0]["coordinates"]
for level in blueprint:
    corner = level["coordinates"]
    for x in range(size):
        for z in range(size):
            if level["placement"][x][z] == "air":
                continue
            blocks.append([corner[0]-offset[0]+x,corner[1]-offset[1],corner[2]-offset[2]+z,level["placement"][x][z]])

with open(target, 'w') as file:
    json.dump({"name": title, "blocks": blocks},file, indent=2)
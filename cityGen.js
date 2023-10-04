// attempting to use this to keep track of which blocks have already had their empty neighbors considered for generation
// otherwise, neighbors can be attempted to be generated multiple times
const dirtyBlocks = new Map()

// the main output of the city gen process is a map of blocks
const blocks = new Map()

//the size (in meters/units) that each block is (each block is a square)
const blockSize = 10

//create the origin block by hand to feed into the generating function
blocks.set('0:0', { coords: [0, 0], blockType: 'commercial', blockSpace: new Array(blockSize).fill(new Array(blockSize).fill(0)), buildings: [] })


//each block has it's buildings generated using the blocks available "near the street"
//https://www.figma.com/file/xEecfDUK8DIqtQOSI81UOj/Barcelona-Inset?type=whiteboard&node-id=0%3A1&t=3IIuGfCHM6eP22bE-1
const barcelonaRingInset = 1

const barcelonaSize = (blockSize - (barcelonaRingInset))

//This is a control variable determining how likely a nighbor is to be generated based on the distance from the origin
// less than 1 makes the city smaller, greater than 1 makes the city larger. Go easy on it as it is not linear. 0-1 is harmless and small. 5 is huge (1000+ buildings)
const sensitivityToDistance = 2

//Similar to above, this is a control variable so you can tune how likely a block is to be commercial based on the distance from the origin
const sensitivityToCommericalOrigin = 1

//block types not yet actually used, the code just uses the string.
//TODO make this array used
const blockTypes = ['residential', 'commercial']


//grab all the blocks that are adjacent to the current block (including diagonals)
function generateAdjacentCoords(x, y) {
    return [[x + 1, y], [x + 1, y + 1], [x, y + 1], [x - 1, y + 1], [x - 1, y], [x - 1, y - 1], [x, y - 1], [x + 1, y - 1]]
}

// go around the ring of the barcelona inset and return the remaining spaces offset by the position given (indexed at 0)
// e.g. if you are a 5 x 5 with inset 1, the first position is 1,1 and so with position 1 your remaining spaces are 2,1 3,1 4,1 4,2 4,3 4,4 3,4 2,4 1,4 1,3 1,2 (TODO: comment sequence auto-completed by AI, check by hand)

function isOnSouthSideOfBlock(row, col) {
    return (col === barcelonaRingInset && row !== 0 && row !== barcelonaSize)
}

function isOnNorthSideOfBlock(row, col) {
    return (col === barcelonaSize - 1 && row !== 0 && row !== barcelonaSize)
}

function isOnEastSideOfBlock(row, col) {
    return (row === barcelonaSize - 1 && col !== 0 && col !== barcelonaSize)
}

function isOnWestSideOfBlock(row, col) {
    return (row === barcelonaRingInset && col !== 0 && col !== barcelonaSize)
}

function getRemainingBarcelonaSpaces({ position }) {
    const barcelonaSize = (blockSize - (barcelonaRingInset))
    const spaces = new Array()
    for (let row = 0; row <= barcelonaSize; row++) {
        for (let col = 0; col <= barcelonaSize; col++) {
            if (isOnNorthSideOfBlock(row, col)) {
                spaces.push({ sideOfBlock: "W", coords: [row, col] })
            } else if (isOnSouthSideOfBlock(row, col)) {
                spaces.push({ sideOfBlock: "E", coords: [row, col] })
            } else if (isOnEastSideOfBlock(row, col)) {
                spaces.push({ sideOfBlock: "S", coords: [row, col] })
            } else if (isOnWestSideOfBlock(row, col)) {
                spaces.push({ sideOfBlock: "N", coords: [row, col] })
            }
        }
    }
    return spaces.slice(position)
}

//building randomness in the blocks is different for different block types. This is a gamma distribution for residential blocks that is supposed
// to tend towards smaller buildlings
const { Gamma } = window.gamma
var dist = new Gamma(1.0, 1.0);

function generatePossibleBuilding(blockType = 'residential') {
    let buildingFootprintX
    let buildingFootprintY
    if (blockType === 'residential') {
        const unifX = Math.random()
        const unifY = Math.random()
        const buildingMaxSize = 5
        buildingFootprintX = Math.floor(dist.cdf(unifX) * buildingMaxSize) + 1
        buildingFootprintY = Math.floor(dist.cdf(unifY) * buildingMaxSize) + 1
    } else if (blockType === 'commercial') {
        //ripped an idea from stack overflow to tend commercial districts towards larger buildings
        //https://stackoverflow.com/questions/16110758/generate-random-number-with-a-non-uniform-distribution
        const unifX = Math.random()
        const unifY = Math.random()
        const buildingMaxSize = 9
        const buildingMinSize = 4
        const betaX = Math.pow(Math.sin(unifX * Math.PI / 2), 2)
        const betaY = Math.pow(Math.sin(unifY * Math.PI / 2), 2)
        const beta_rightX = (betaX > 0.5) ? 2 * betaX - 1 : 2 * (1 - betaX) - 1;
        const beta_rightY = (betaY > 0.5) ? 2 * betaY - 1 : 2 * (1 - betaY) - 1;
        buildingFootprintX = Math.max(buildingMinSize, Math.floor(beta_rightX * buildingMaxSize) + 1)
        buildingFootprintY = Math.min(buildingMinSize, Math.floor(beta_rightY * buildingMaxSize) + 1)

    }
    return {
        buildingFootprint: [buildingFootprintX, buildingFootprintY]
    }
}

//the way that space is being checked is by overlaying a blockSize x blockSize grid on top of the block,
// generated a matching grid and putting the building on top of it. If there is a collision, the building is not placed
//example
/*
existing     new 2x2 building
0 0 0 0 0    0 0 1 1 0
0 1 0 0 0    0 0 1 1 0
0 0 0 1 0 -> 0 0 0 0 0
0 1 0 1 0    0 0 0 0 0
0 0 0 0 0    0 0 0 0 0
fits!

existing     new 2x2 building
0 0 0 0 0    0 0 0 0 0
0 1 0 0 0    0 1 1 0 0
0 0 0 1 0 -> 0 1 1 0 0
0 1 0 1 0    0 0 0 0 0
0 0 0 0 0    0 0 0 0 0
doesnt fit! buildings already in that space
*/

//it also checks some specific parameters like out of block bounds
//I also made the choice to avoid everything outside the barcelona ring inset box. This seems to be bugged on one side of the grid
// and buildings can end up on the very edge
function checkIfBuildingFits({ block, buildingFootprint, buildingOrigin }) {
    const [x, y] = buildingOrigin
    const [blockX, blockY] = block.coords
    const blockSpace = block.blockSpace
    const buildingSpace = new Array(buildingFootprint[0]).fill(new Array(buildingFootprint[1]).fill(1))
    const newBlockSpace = blockSpace.map((row, rowIndex) => {
        return row.map((col, colIndex) => {
            const buildingSpaceRow = buildingSpace[rowIndex - x]
            if (buildingSpaceRow) {
                const buildingSpaceCol = buildingSpaceRow[colIndex - y]
                if (buildingSpaceCol) {
                    return buildingSpaceCol
                }
            }
            return col
        })
    })
    //if a building would be out of bounds of the grid, return false
    if (x < 0 || y < 0 || x + buildingFootprint[0] > blockSize || y + buildingFootprint[1] > blockSize) {
        return false
    }

    //if a building would be out of bounds of the barcelona ring, return false
    const barcelonaSize = (blockSize - (barcelonaRingInset))
    if (x < barcelonaRingInset || y < barcelonaRingInset || x + buildingFootprint[0] > barcelonaSize || y + buildingFootprint[1] > barcelonaSize) {
        return false
    }


    //detect collision between block space and new block space
    // only check the area of the new building
    let collision = false
    for (let row = 0; row < buildingFootprint[0]; row++) {
        for (let col = 0; col < buildingFootprint[1]; col++) {
            const blockSpaceValue = blockSpace[row + x][col + y]
            const newBlockSpaceValue = newBlockSpace[row + x][col + y]
            if (blockSpaceValue && newBlockSpaceValue) {
                collision = true
                break
            }
        }
    }

    // if no collision, add the building to the block space by logical ORing the values
    if (!collision) {
        block.blockSpace = newBlockSpace.map((row, rowIndex) => {
            return row.map((col, colIndex) => {
                const blockSpaceValue = blockSpace[rowIndex][colIndex]
                const newBlockSpaceValue = newBlockSpace[rowIndex][colIndex]
                return blockSpaceValue || newBlockSpaceValue
            })
        })
    }
    return !collision
}

function generateEvenNumber(i) {
    return i * 2
}

function generateOddNumber(i) {
    return (i * 2) + 1
}

//https://stackoverflow.com/questions/13627308/add-st-nd-rd-and-th-ordinal-suffix-to-a-number
function ordinalSuffix(i) {
    var j = i % 10,
        k = i % 100;
    if (j == 1 && k != 11) {
        return i + "st";
    }
    if (j == 2 && k != 12) {
        return i + "nd";
    }
    if (j == 3 && k != 13) {
        return i + "rd";
    }
    return i + "th";
}

function getAdjacentStreets({ block }) {
    const [blockX, blockY] = block.coords
    let northStreetDetermination = (blockX > 0) ? "W" : "E"
    let eastStreetDetermination = (blockY > 0) ? "N" : "S"
    let southStreetDetermination = (blockX > 0) ? "W" : "E"
    let westStreetDetermination = (blockY > 0) ? "N" : "S"
    let EStreetNumber
    let WStreetNumber
    let NStreetNumber
    let SStreetNumber
    if (blockX >= 0) {
        EStreetNumber = -generateEvenNumber(Math.abs(blockX) + 1)
        WStreetNumber = -generateEvenNumber(Math.abs(blockX))
    } else {
        EStreetNumber = generateEvenNumber(Math.abs(blockX) - 1)
        WStreetNumber = generateEvenNumber(Math.abs(blockX))
    }
    if (blockY >= 0) {
        NStreetNumber = generateOddNumber(Math.abs(blockY) + 1)
        SStreetNumber = generateOddNumber(Math.abs(blockY))
    } else {
        NStreetNumber = -generateOddNumber(Math.abs(blockY) - 1)
        SStreetNumber = -generateOddNumber(Math.abs(blockY))
    }
    return [
        `${northStreetDetermination} ${ordinalSuffix(NStreetNumber)}`,
        `${eastStreetDetermination} ${ordinalSuffix(EStreetNumber)}`,
        `${southStreetDetermination} ${ordinalSuffix(SStreetNumber)}`,
        `${westStreetDetermination} ${ordinalSuffix(WStreetNumber)}`]

}

function getStreetClosestToEachBuildingOrigin({ adjacentStreets, sideOfBlock }) {
    if (sideOfBlock === 'S') {
        return adjacentStreets[0]
    } else if (sideOfBlock === 'E') {
        return adjacentStreets[1]
    }
    else if (sideOfBlock === 'N') {
        return adjacentStreets[2]
    }
    else if (sideOfBlock === 'W') {
        return adjacentStreets[3]
    }
}

function generateAddressesForBlock({ block }) {
    const [blockX, blockY] = block.coords
    const adjacentStreets = getAdjacentStreets({ block })
    let buildingCounts = { N: 100 * Math.abs(blockX) + 11, E: 100 * Math.abs(blockY) + 1, S: 100 * Math.abs(blockX) + 1, W: 100 * Math.abs(blockY) + 11 }
    for (const building of block.buildings) {
        const street = getStreetClosestToEachBuildingOrigin({ adjacentStreets, sideOfBlock: building.sideOfBlock })
        building.address = `${buildingCounts[building.sideOfBlock]} ${street}`
        buildingCounts[building.sideOfBlock] += 1
    }
}

//walk over each position in the barcelona ring, try to make a building, see if it fits, if so add it
function fillBlock({ block }) {
    const remainingBarcelonaSpaces = getRemainingBarcelonaSpaces({ position: 0 })
    for (const space of remainingBarcelonaSpaces) {
        const newBuilding = { block, buildingFootprint: generatePossibleBuilding(block.blockType).buildingFootprint, buildingOrigin: space.coords, sideOfBlock: space.sideOfBlock }
        const canBuild = checkIfBuildingFits(newBuilding)
        if (canBuild) {
            block.buildings.push(newBuilding)
        }
        //this method updates the state of each building with an address
    }
    generateAddressesForBlock({ block })
}

//This is generating the neighbors of the block recursively and uses a handmade falloff function to determine the likelihood of a neighbor being generated
function generateNeighbors({ block, allBlocks }) {
    const [x, y] = block.coords
    dirtyBlocks.set(`${x}:${y}`, true)
    const distanceFromOrigin = Math.abs(x) + Math.abs(y)
    const allNeighbors = generateAdjacentCoords(x, y)
    const neighbors = allNeighbors
        .filter(([x, y]) => {
            const distanceMetric = sensitivityToDistance * (1 / (distanceFromOrigin + 1))
            const shouldGenerate = Math.random() < distanceMetric
            const condition = shouldGenerate && !allBlocks.has(`${x}:${y}`) && !dirtyBlocks.has(`${x}:${y}`)
            return condition
        })



    const distanceMetric = sensitivityToCommericalOrigin * (1 / (distanceFromOrigin + 1))
    const shouldGenerateCommerical = Math.random() < distanceMetric
    const blockType = shouldGenerateCommerical ? 'commercial' : 'residential'
    const newNeighborObjs = []
    for (const neighbor of neighbors) {
        const [x, y] = neighbor
        const newNeighborObj = { coords: [x, y], blockType, blockSpace: new Array(blockSize).fill(new Array(blockSize).fill(0)), buildings: [] }
        newNeighborObjs.push(newNeighborObj)
        allBlocks.set(`${x}:${y}`, newNeighborObj)
        generateNeighbors({ block: newNeighborObj, allBlocks })
    }
}


import * as THREE from 'three';

import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let selectedBuilding = null

//actually generate a city
generateNeighbors({
    block: blocks.get('0:0'),
    allBlocks: blocks
})

let minX = 0, maxX = 0, minY = 0, maxY = 0
for (const block of blocks.values()) {
    fillBlock({ block })
    const [x, y] = block.coords
    if (x < minX) {
        minX = x
    }
    if (x > maxX) {
        maxX = x
    }
    if (y < minY) {
        minY = y
    }
    if (y > maxY) {
        maxY = y
    }
}

let cityWidth = maxX - minX
let cityHeight = maxY - minY
let cityArea = cityWidth * cityHeight

let camera, scene, renderer, controls, stats;

let blockMesh;
const numCityBlocks = blocks.size

const buildingMeshes = []

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(1, 1);

const white = new THREE.Color().setHex(0xffffff);
const brown = new THREE.Color().setHex(0x999900);
const grey = new THREE.Color().setHex(0xaaaaaa);
const green = new THREE.Color().setHex(0x00ff00);
const blue = new THREE.Color().setHex(0x0000ff);
const red = new THREE.Color().setHex(0xff0000);
const northRed = new THREE.Color().setHex(0xdd0000);
const eastRed = new THREE.Color().setHex(0x990000);
const southRed = new THREE.Color().setHex(0x440000);
const westRed = new THREE.Color().setHex(0x220000);

init();
animate();

function init() {

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 10000);
    const distanceAwayFromCamera = 6 * Math.max(cityWidth, cityHeight)
    camera.position.set(0, distanceAwayFromCamera, -distanceAwayFromCamera);
    camera.lookAt(0, 0, 0);

    scene = new THREE.Scene();

    const light = new THREE.HemisphereLight(0xffffff, 0x888888, 3);
    light.position.set(0, 1, 0);
    scene.add(light);

    const blockGeometry = new THREE.PlaneGeometry(blockSize, blockSize);
    const blockMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff });
    blockMesh = new THREE.InstancedMesh(blockGeometry, blockMaterial, numCityBlocks);

    let blockCount = 0;


    const blockMatrix = new THREE.Matrix4();

    const blockSizeInMeters = blockSize
    const spaceBetweenBuildings = .9

    //this is the main loop that generates the blocks and buildings based on the city gen output
    for (const block of blocks.values()) {
        const [xBlock, yBlock] = block.coords
        const xBlockOffset = xBlock * blockSizeInMeters
        const yBlockOffset = yBlock * blockSizeInMeters
        blockMatrix.makeRotationX(- Math.PI / 2)
        blockMatrix.setPosition(xBlockOffset + (blockSizeInMeters / 2), 0, yBlockOffset + (blockSizeInMeters / 2));
        blockMesh.setMatrixAt(blockCount, blockMatrix);
        if (xBlock === 0 && yBlock === 0) {
            blockMesh.setColorAt(blockCount, red);
        } else if (xBlock === 0 && yBlock === 1) {
            blockMesh.setColorAt(blockCount, northRed);
        } else if (xBlock === 1 && yBlock === 0) {
            blockMesh.setColorAt(blockCount, eastRed);
        } else if (xBlock === 0 && yBlock === -1) {
            blockMesh.setColorAt(blockCount, southRed);
        } else if (xBlock === -1 && yBlock === 0) {
            blockMesh.setColorAt(blockCount, westRed);
        }
        else if (block.blockType === 'commercial') {
            blockMesh.setColorAt(blockCount, grey);
        } else if (block.blockType === 'residential') {
            blockMesh.setColorAt(blockCount, brown);
        }

        blockCount++
        for (const building of block.buildings) {
            const { buildingOrigin, buildingFootprint } = building
            const geometry = new THREE.BoxGeometry(1, 1, 1);
            const material = new THREE.MeshPhongMaterial({ color: 0xffffff });
            const buildingMesh = new THREE.Mesh(geometry, material);
            if (block.blockType === 'commercial') {
                buildingMesh.position.set(xBlockOffset + (blockSize - buildingOrigin[1]) - buildingFootprint[1] / 2, (buildingFootprint[0] + buildingFootprint[1]) / (2), yBlockOffset + (blockSize - buildingOrigin[0]) - buildingFootprint[0] / 2)
                buildingMesh.scale.set(buildingFootprint[1] * spaceBetweenBuildings, (buildingFootprint[0] + buildingFootprint[1]), buildingFootprint[0] * spaceBetweenBuildings)
                buildingMesh.material.color.set(white);
            } else if (block.blockType === 'residential') {
                buildingMesh.position.set(xBlockOffset + (blockSize - buildingOrigin[1]) - buildingFootprint[1] / 2, (buildingFootprint[0] + buildingFootprint[1]) / (2 * 2), yBlockOffset + (blockSize - buildingOrigin[0]) - buildingFootprint[0] / 2)
                buildingMesh.scale.set(buildingFootprint[1] * spaceBetweenBuildings, (buildingFootprint[0] + buildingFootprint[1]) / 2, buildingFootprint[0] * spaceBetweenBuildings)
                buildingMesh.material.color.set(green);
            }
            buildingMesh.buildingData = building
            buildingMeshes.push(buildingMesh)
            scene.add(buildingMesh);
            if (building.address.includes('302')) {
                buildingMesh.material.color.set(blue);
            }
        }
        for (let row = 0; row < blockSize; row++) {
            for (let col = 0; col < blockSize; col++) {

                if (block.blockSpace[row][col]) {
                }
            }
        }
    }

    scene.add(blockMesh);

    const gui = new GUI();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enableZoom = true;
    controls.enablePan = false;

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);

}

function onMouseDown(event) {
    if (event.buttons === 2) {
        console.log(selectedBuilding.buildingData)
    }
}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);

}

function onMouseMove(event) {

    event.preventDefault();
    mouse.x = (event.offsetX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
}

function animate() {

    requestAnimationFrame(animate);

    controls.update();

    raycaster.setFromCamera(mouse, camera);

    //commented out this thing that would change the color of things under the mouse. Feels useful.
    const intersection = raycaster.intersectObjects(buildingMeshes);
    if (intersection.length > 0) {
        if (intersection[0].object !== selectedBuilding) {
            if (selectedBuilding?.buildingData?.block.blockType === 'commercial') {
                selectedBuilding.material.color.set(white);
            } else if (selectedBuilding?.buildingData?.block.blockType === 'residential') {
                selectedBuilding.material.color.set(green);
            }
            selectedBuilding = intersection[0].object
        }

        // selectedBuilding.material.color.setHex(0xff0000)
        // }
        // selectedBuilding = intersection[0].object
        intersection[0].object.material.color.setHex(0xff0000)
        // }
    }
    render();
}

function render() {

    renderer.render(scene, camera);

}
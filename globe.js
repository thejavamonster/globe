import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000510); // Deep space blue
const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // Reduced to preserve texture colors
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Set up post-processing for bloom
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.8, // Reduced strength to preserve base colors
    0.4, // radius
    0.9 // Higher threshold - only brightest parts bloom
);
composer.addPass(bloomPass);

// Controls (ES module version)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Globe
const sphereGeometry = new THREE.SphereGeometry(5, 128, 128);
const textureLoader = new THREE.TextureLoader();

// Load multiple textures
const nightTexture = textureLoader.load('assets/earthnight.jpg');
const dayTexture = textureLoader.load('assets/earth.jpg');

// Improve texture quality
[nightTexture, dayTexture].forEach(texture => {
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
});

// Custom shader material for realistic day/night terminator
const sphereMaterial = new THREE.ShaderMaterial({
    uniforms: {
        dayTexture: { value: dayTexture },
        nightTexture: { value: nightTexture },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) }, // Sun direction (will rotate)
        time: { value: 0 }
    },
    vertexShader: `
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vUv = uv;
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D dayTexture;
        uniform sampler2D nightTexture;
        uniform vec3 sunDirection;
        uniform float time;
        
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        
        void main() {
            vec3 dayColor = texture2D(dayTexture, vUv).rgb;
            vec3 nightColor = texture2D(nightTexture, vUv).rgb;
            
            // Calculate sun illumination based on surface normal
            float sunDot = dot(normalize(vNormal), normalize(sunDirection));
            
            // Sharp terminator line - exactly half the globe in shadow
            float dayFactor = step(0.0, sunDot);
            
            // Soften the terminator line slightly for realism
            float terminator = smoothstep(-0.02, 0.02, sunDot);
            
            // Mix between day and night textures
            vec3 color = mix(nightColor, dayColor, terminator);
            
            // Add city lights glow on night side
            float nightSide = 1.0 - terminator;
            vec3 cityGlow = nightColor * nightSide * 0.8;
            
            // Enhance city lights brightness
            color += cityGlow * 0.5;
            
            gl_FragColor = vec4(color, 1.0);
        }
    `
});

const globe = new THREE.Mesh(sphereGeometry, sphereMaterial);
scene.add(globe);

// Add atmospheric glow
const atmosphereGeometry = new THREE.SphereGeometry(5.1, 64, 64);
const atmosphereMaterial = new THREE.MeshPhongMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.15,
    side: THREE.BackSide,
    emissive: new THREE.Color(0x112244),
    emissiveIntensity: 0.2
});
const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
scene.add(atmosphere);

// Minimal lighting (shader handles day/night)
const ambientLight = new THREE.AmbientLight(0x202020, 0.3); // Very dim ambient
scene.add(ambientLight);

// Add stars
const starsGeometry = new THREE.BufferGeometry();
const starsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2,
    transparent: true
});

const starsVertices = [];
for (let i = 0; i < 10000; i++) {
    const x = (Math.random() - 0.5) * 2000;
    const y = (Math.random() - 0.5) * 2000;
    const z = (Math.random() - 0.5) * 2000;
    starsVertices.push(x, y, z);
}

starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
const stars = new THREE.Points(starsGeometry, starsMaterial);
scene.add(stars);

camera.position.z = 15;

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}
window.addEventListener('resize', onWindowResize);

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Rotate globe and atmosphere
    globe.rotation.y += 0.001;
    atmosphere.rotation.y += 0.001;
    
    // Subtle star movement
    stars.rotation.y += 0.0001;
    
    // Slowly rotate the sun direction to create day/night cycle
    const time = Date.now() * 0.0002; // Adjust speed here
    sphereMaterial.uniforms.sunDirection.value.set(
        Math.cos(time),
        0,
        Math.sin(time)
    );
    sphereMaterial.uniforms.time.value = time;
    
    controls.update();
    
    // Use composer instead of renderer for bloom effect
    composer.render();
}
animate();

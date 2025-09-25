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

const renderer = new THREE.WebGLRenderer({ 
    antialias: true,
    powerPreference: "high-performance"
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3)); // Increased from 2 to 3
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8; // Reduced to prevent color washing
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

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Globe - Ultra high resolution geometry
const sphereGeometry = new THREE.SphereGeometry(5, 256, 256);
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

// Custom shader material for day/night blend
const sphereMaterial = new THREE.ShaderMaterial({
    uniforms: {
        dayTexture: { value: dayTexture },
        nightTexture: { value: nightTexture },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) }, // Sun direction
        atmosphereColor: { value: new THREE.Color(0x0088ff) }
    },
    vertexShader: `
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        void main() {
            // Use object space normal (not transformed by camera)
            vNormal = normalize(normal);
            vUv = uv;
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D dayTexture;
        uniform sampler2D nightTexture;
        uniform vec3 sunDirection;
        uniform vec3 atmosphereColor;
        
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        void main() {
            vec3 dayColor = texture2D(dayTexture, vUv).rgb;
            vec3 nightColor = texture2D(nightTexture, vUv).rgb;
            
            // Enhance contrast and vibrancy - more balanced
            dayColor = pow(dayColor, vec3(0.9)) * 1.1; // Moderate brightness increase
            nightColor = pow(nightColor, vec3(1.2)) * 0.85; // Less dark, more visible
            
            // Calculate sun illumination using object-space normal
            float sunIntensity = dot(normalize(vNormal), normalize(sunDirection));
            
            // Very wide gradient like real Earth's terminator
            float terminator = smoothstep(-0.7, 0.7, sunIntensity);
            
            // Create enhanced twilight coloring with balanced contrast
            float twilight = smoothstep(-0.4, 0.4, sunIntensity);
            vec3 twilightColor = mix(nightColor * 0.9, dayColor * 0.95, twilight);
            
            // Blend textures with very gradual transition
            vec3 color = mix(nightColor, twilightColor, terminator);
            color = mix(color, dayColor * 0.9, smoothstep(-0.3, 0.5, sunIntensity));
            
            // Apply balanced color grading
            color = pow(color, vec3(0.95)); // Gentler gamma correction
            color = mix(color, color * color, 0.2); // Less aggressive saturation
            
            // Add city lights ONLY on night side
            float nightSide = 1.0 - smoothstep(-0.2, 0.1, sunIntensity); // Stricter night-only
            vec3 cityLights = nightColor * nightSide * 1.2;
            color += cityLights * 0.7 * nightSide; // Double-ensure no day glow
            
            gl_FragColor = vec4(color, 1.0);
        }
    `
});

const globe = new THREE.Mesh(sphereGeometry, sphereMaterial);
scene.add(globe);

// Add atmospheric glow - High resolution
const atmosphereGeometry = new THREE.SphereGeometry(5.1, 128, 128);
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

// Minimal lighting (no directional sun light)
const ambientLight = new THREE.AmbientLight(0x404040, 0.3); // Very low ambient
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
    
    // Rotate the sun direction to create day/night cycle
    const time = Date.now() * 0.0001;
    sphereMaterial.uniforms.sunDirection.value.set(
        Math.cos(time),
        0,
        Math.sin(time)
    );
    
    controls.update();
    
    // Use composer instead of renderer for bloom effect
    composer.render();
}
animate();
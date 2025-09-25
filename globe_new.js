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

// Weather data storage and visualization
const weatherPoints = [];
const weatherGroup = new THREE.Group();
scene.add(weatherGroup);

// Weather point geometry and materials
const weatherGeometry = new THREE.SphereGeometry(0.08, 12, 12);
const weatherMaterials = {
    clear: new THREE.MeshBasicMaterial({ 
        color: 0xffdd00, 
        emissive: 0xffaa00, 
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.9
    }),
    cloudy: new THREE.MeshBasicMaterial({ 
        color: 0xaaaaaa, 
        emissive: 0x666666, 
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.8
    }),
    rainy: new THREE.MeshBasicMaterial({ 
        color: 0x3366ff, 
        emissive: 0x1144cc, 
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.9
    }),
    snowy: new THREE.MeshBasicMaterial({ 
        color: 0xffffff, 
        emissive: 0xdddddd, 
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.9
    }),
    thunderstorm: new THREE.MeshBasicMaterial({ 
        color: 0xff3300, 
        emissive: 0xff1100, 
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.95
    })
};

// Function to convert lat/lon to 3D position on sphere
function latLonToVector3(lat, lon, radius = 5.02) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    
    const x = -radius * Math.sin(phi) * Math.cos(theta);
    const z = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    
    return new THREE.Vector3(x, y, z);
}

// Function to determine weather condition from WMO code
function getWeatherCondition(wmoCode) {
    if (wmoCode <= 3) return 'clear';
    if (wmoCode <= 48) return 'cloudy';
    if (wmoCode <= 67 || (wmoCode >= 80 && wmoCode <= 82)) return 'rainy';
    if (wmoCode <= 77 || (wmoCode >= 85 && wmoCode <= 86)) return 'snowy';
    if (wmoCode >= 95) return 'thunderstorm';
    return 'cloudy';
}

// Function to fetch weather data from Open-Meteo
async function fetchWeatherData() {
    const locations = [
        // Major cities worldwide
        { lat: 40.7128, lon: -74.0060, name: "New York" },
        { lat: 51.5074, lon: -0.1278, name: "London" },
        { lat: 48.8566, lon: 2.3522, name: "Paris" },
        { lat: 35.6762, lon: 139.6503, name: "Tokyo" },
        { lat: -33.8688, lon: 151.2093, name: "Sydney" },
        { lat: 55.7558, lon: 37.6176, name: "Moscow" },
        { lat: 39.9042, lon: 116.4074, name: "Beijing" },
        { lat: 19.4326, lon: -99.1332, name: "Mexico City" },
        { lat: -34.6037, lon: -58.3816, name: "Buenos Aires" },
        { lat: 30.0444, lon: 31.2357, name: "Cairo" },
        { lat: 28.6139, lon: 77.2090, name: "Delhi" },
        { lat: 1.3521, lon: 103.8198, name: "Singapore" },
        { lat: -26.2041, lon: 28.0473, name: "Johannesburg" },
        { lat: 59.3293, lon: 18.0686, name: "Stockholm" },
        { lat: -22.9068, lon: -43.1729, name: "Rio de Janeiro" },
        { lat: 25.2048, lon: 55.2708, name: "Dubai" },
        { lat: 37.7749, lon: -122.4194, name: "San Francisco" },
        { lat: 52.5200, lon: 13.4050, name: "Berlin" },
        { lat: 41.9028, lon: 12.4964, name: "Rome" },
        { lat: 64.1466, lon: -21.9426, name: "Reykjavik" },
        // Additional grid points for better coverage
        { lat: 60, lon: 0 }, { lat: 60, lon: 60 }, { lat: 60, lon: 120 }, { lat: 60, lon: -120 }, { lat: 60, lon: -60 },
        { lat: 30, lon: 0 }, { lat: 30, lon: 60 }, { lat: 30, lon: 120 }, { lat: 30, lon: -120 }, { lat: 30, lon: -60 },
        { lat: 0, lon: 0 }, { lat: 0, lon: 60 }, { lat: 0, lon: 120 }, { lat: 0, lon: -120 }, { lat: 0, lon: -60 },
        { lat: -30, lon: 0 }, { lat: -30, lon: 60 }, { lat: -30, lon: 120 }, { lat: -30, lon: -120 }, { lat: -30, lon: -60 },
        { lat: -60, lon: 0 }, { lat: -60, lon: 60 }, { lat: -60, lon: 120 }, { lat: -60, lon: -120 }, { lat: -60, lon: -60 }
    ];
    
    console.log('Fetching weather data for', locations.length, 'locations...');
    
    for (const location of locations) {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,weather_code&timezone=auto`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.current) {
                const condition = getWeatherCondition(data.current.weather_code);
                const temperature = data.current.temperature_2m;
                
                // Create weather point
                const material = weatherMaterials[condition].clone();
                const weatherPoint = new THREE.Mesh(weatherGeometry, material);
                
                // Position on globe surface
                const position = latLonToVector3(location.lat, location.lon);
                weatherPoint.position.copy(position);
                
                // Store weather data
                weatherPoint.userData = {
                    condition,
                    temperature,
                    location: location.name || `${location.lat.toFixed(1)}°, ${location.lon.toFixed(1)}°`,
                    wmoCode: data.current.weather_code
                };
                
                weatherGroup.add(weatherPoint);
                weatherPoints.push(weatherPoint);
            }
        } catch (error) {
            console.warn('Failed to fetch weather for', location, error);
        }
    }
    
    console.log('Weather data loaded for', weatherPoints.length, 'locations');
}

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

// Raycaster for weather point interaction
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Create tooltip element
const tooltip = document.createElement('div');
tooltip.style.position = 'absolute';
tooltip.style.padding = '10px';
tooltip.style.background = 'rgba(0, 0, 0, 0.8)';
tooltip.style.color = 'white';
tooltip.style.borderRadius = '5px';
tooltip.style.pointerEvents = 'none';
tooltip.style.display = 'none';
tooltip.style.fontSize = '12px';
tooltip.style.zIndex = '1000';
document.body.appendChild(tooltip);

// Mouse move handler for tooltips
function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(weatherPoints);
    
    if (intersects.length > 0) {
        const point = intersects[0].object;
        const data = point.userData;
        
        tooltip.style.display = 'block';
        tooltip.style.left = event.clientX + 10 + 'px';
        tooltip.style.top = event.clientY - 10 + 'px';
        tooltip.innerHTML = `
            <strong>${data.location}</strong><br>
            Weather: ${data.condition}<br>
            Temperature: ${data.temperature}°C<br>
            WMO Code: ${data.wmoCode}
        `;
        
        // Highlight the point
        point.scale.set(1.5, 1.5, 1.5);
    } else {
        tooltip.style.display = 'none';
        // Reset all point scales
        weatherPoints.forEach(point => {
            point.scale.set(1, 1, 1);
        });
    }
}

window.addEventListener('mousemove', onMouseMove);

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Rotate globe and atmosphere
    globe.rotation.y += 0.001;
    atmosphere.rotation.y += 0.001;
    
    // Rotate weather points with globe
    weatherGroup.rotation.y += 0.001;
    
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

// Initialize weather data
fetchWeatherData().catch(console.error);

animate();
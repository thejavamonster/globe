import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import tz from 'https://cdn.skypack.dev/tz-lookup';

// Load country data
let countriesData = null;
fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson')
    .then(response => response.json())
    .then(data => {
        countriesData = data;
        console.log('Country data loaded:', countriesData.features.length, 'countries');
    })
    .catch(error => {
        console.error('Failed to load country data:', error);
    });

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

// Raycaster for click detection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

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

// Add click marker for debugging
const markerGeometry = new THREE.SphereGeometry(0.05, 16, 16);
const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const clickMarker = new THREE.Mesh(markerGeometry, markerMaterial);
clickMarker.visible = false;
scene.add(clickMarker);

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

// Point-in-polygon test (simplified version)
function pointInPolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    
    return inside;
}

// Check if point is in country geometry
function pointInCountry(lat, lon, countryGeometry) {
    const point = [lon, lat];
    
    if (countryGeometry.type === 'Polygon') {
        return pointInPolygon(point, countryGeometry.coordinates[0]);
    } else if (countryGeometry.type === 'MultiPolygon') {
        return countryGeometry.coordinates.some(polygon => 
            pointInPolygon(point, polygon[0])
        );
    }
    
    return false;
}

// Click handling
let isDragging = false;
let mouseDownTime = 0;

function onMouseDown(event) {
    mouseDownTime = Date.now();
    isDragging = false;
}

function onMouseMove(event) {
    if (Date.now() - mouseDownTime > 100) {
        isDragging = true;
    }
}

function onMouseClick(event) {
    console.log('Click detected!'); // Debug
    
    // Prevent clicks when dragging
    if (isDragging) {
        console.log('Dragging detected, ignoring click');
        return;
    }
    
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    console.log('Mouse coordinates:', mouse.x, mouse.y); // Debug
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(globe);
    
    console.log('Intersects found:', intersects.length); // Debug
    
    if (intersects.length > 0) {
        const intersection = intersects[0];
        const point = intersection.point;
        console.log('Intersection point:', point);
        
        // DEBUG: Try multiple coordinate conversion mssethods
        const uv = intersection.uv;
        const point3D = intersection.point;
        const normalized = point3D.clone().normalize();
        
        console.log('=== DEBUGGING COORDINATES ===');
        console.log('3D intersection point:', point3D);
        console.log('UV coordinates:', uv);
        console.log('Normalized 3D:', normalized);
        
        // Method 1: UV coordinates (texture mapping)
        const lon1 = (uv.x * 360) - 180;
        const lat1 = 90 - (uv.y * 180);
        console.log('Method 1 (UV): lat=', lat1, 'lon=', lon1);
        
        // Method 2: Standard spherical coordinates
        const lat2 = Math.asin(normalized.y) * (180 / Math.PI);
        const lon2 = Math.atan2(normalized.z, normalized.x) * (180 / Math.PI);
        console.log('Method 2 (Spherical): lat=', lat2, 'lon=', lon2);
        
        // Method 3: Adjusted for Three.js coordinate system
        const lat3 = Math.asin(normalized.y) * (180 / Math.PI);
        const lon3 = Math.atan2(-normalized.z, normalized.x) * (180 / Math.PI);
        console.log('Method 3 (Adjusted Z): lat=', lat3, 'lon=', lon3);
        
        // Method 4: Different UV interpretation
        const lon4 = (uv.x - 0.5) * 360;
        const lat4 = (0.5 - uv.y) * 180;
        console.log('Method 4 (UV centered): lat=', lat4, 'lon=', lon4);
        
        // Use Method 3 (adjusted Z) - shows correct coordinates: +27.6°, -82.5° for Florida
        const lat = lat3;
        const lon = lon3;
        
        // Place visual marker at click location
        clickMarker.position.copy(point3D);
        clickMarker.position.normalize().multiplyScalar(5.02); // Slightly above surface
        clickMarker.visible = true;
        
        // Find country using GeoJSON data
        const country = findCountryByCoordinates(lat, lon);
        console.log('Found country:', country);
        console.log('=============================');
        
        updateSidebar(country, lat, lon, {
            uv: uv,
            methods: {
                method1: { lat: lat1, lon: lon1 },
                method2: { lat: lat2, lon: lon2 },
                method3: { lat: lat3, lon: lon3 },
                method4: { lat: lat4, lon: lon4 }
            }
        });
        openSidebar();
    }
}

function findCountryByCoordinates(lat, lon) {
    if (!countriesData) {
        return { 
            name: 'Loading countries...', 
            properties: {},
            lat: lat, 
            lon: lon 
        };
    }
    
    // Find country that contains this point
    const country = countriesData.features.find(feature => {
        if (feature.geometry) {
            return pointInCountry(lat, lon, feature.geometry);
        }
        return false;
    });
    
    if (country) {
        return {
            name: country.properties.NAME || country.properties.name || 'Unknown Country',
            properties: country.properties,
            lat: lat,
            lon: lon
        };
    }
    
    return {
        name: 'Ocean/International Waters',
        properties: {},
        lat: lat,
        lon: lon
    };
}

function updateSidebar(country, clickLat, clickLng, debug = null) {
    document.getElementById('country-name').textContent = country.name;
    
    let coordText = `${clickLat.toFixed(2)}°, ${clickLng.toFixed(2)}°`;
    
    /*if (debug) {
        coordText += `\n\nDEBUG METHODS:`;
        coordText += `\nUV: ${debug.uv.x.toFixed(3)}, ${debug.uv.y.toFixed(3)}`;
        coordText += `\nMethod 1: ${debug.methods.method1.lat.toFixed(1)}°, ${debug.methods.method1.lon.toFixed(1)}°`;
        coordText += `\nMethod 2: ${debug.methods.method2.lat.toFixed(1)}°, ${debug.methods.method2.lon.toFixed(1)}°`;
        coordText += `\nMethod 3: ${debug.methods.method3.lat.toFixed(1)}°, ${debug.methods.method3.lon.toFixed(1)}°`;
        coordText += `\nMethod 4: ${debug.methods.method4.lat.toFixed(1)}°, ${debug.methods.method4.lon.toFixed(1)}°`;
    }*/
    
    document.getElementById('coordinates').style.whiteSpace = 'pre-line';
    document.getElementById('coordinates').textContent = coordText;
    
    // Calculate local time using tz-lookup (offline, client-side)
    function getLocalTimeFromLatLng(lat, lng) {
        try {
            // Use tz-lookup to get IANA timezone name
            const timezone = tz(lat, lng);
            console.log('Timezone found:', timezone); // Debug
            
            if (!timezone) {
                throw new Error('No timezone found for coordinates');
            }
            
            // Format current time in the target timezone using Intl
            const now = new Date();
            const localTimeString = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            }).format(now);
            
            // Get hour in 24h format to determine day/night
            const hour24 = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                hour: '2-digit',
                hour12: false
            }).format(now);
            
            // Get timezone abbreviation
            const abbreviation = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                timeZoneName: 'short'
            }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value || 'UTC';
            
            return {
                timeString: `${localTimeString} (${abbreviation})`,
                timezone: timezone,
                abbreviation: abbreviation,
                hour24: parseInt(hour24, 10)
            };
            
        } catch (error) {
            console.error('tz-lookup failed:', error);
            
            // Simple fallback using basic offset calculation
            const offsetHours = Math.round(lng / 15);
            const now = new Date();
            const utc = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
            const localTime = new Date(utc.getTime() + (offsetHours * 3600000));
            
            return {
                timeString: localTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + ' (Est.)',
                timezone: 'Estimated',
                abbreviation: 'EST',
                hour24: localTime.getHours()
            };
        }
    }
    
    // Get timezone and update display (synchronous now!)
    const timeInfo = getLocalTimeFromLatLng(clickLat, clickLng);
    document.getElementById('local-time').textContent = timeInfo.timeString;
    
    const isDaytime = timeInfo.hour24 >= 6 && timeInfo.hour24 < 18;
    document.getElementById('daynight-status').textContent = 
        isDaytime ? '☀️ Daytime' : '🌙 Nighttime';
        
    console.log('Time calculated:', timeInfo); // Debug
}

function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.add('open');
        console.log('Sidebar opened'); // Debug
    } else {
        console.error('Sidebar element not found!');
    }
}

// Make functions globally accessible
window.openSidebar = openSidebar;

window.addEventListener('mousedown', onMouseDown);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('click', onMouseClick);

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
    
    // Don't rotate globe - keep it stationary for accurate coordinate mapping
    // globe.rotation.y += 0.001;
    // atmosphere.rotation.y += 0.001;
    
    // Subtle star movement
    stars.rotation.y += 0.0001;
    
    // Calculate real-time sun position based on current UTC time
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const utcSeconds = now.getUTCSeconds();
    
    // Convert current UTC time to fraction of day (0-1)
    const timeOfDay = (utcHours + utcMinutes/60 + utcSeconds/3600) / 24;
    
    // Calculate sun angle (0° at noon UTC, 180° at midnight UTC)
    // The sun is at longitude 0° (Greenwich) at noon UTC
    const sunAngle = (timeOfDay * 2 * Math.PI) - Math.PI; // -π to π
    
    // Set sun direction (X-axis represents longitude 0°)
    sphereMaterial.uniforms.sunDirection.value.set(
        Math.cos(sunAngle), // East-West position
        0,                  // No north-south (simplified)
        Math.sin(sunAngle)  // Z-component
    );
    
    controls.update();
    
    // Use composer instead of renderer for bloom effect
    composer.render();
}
animate();
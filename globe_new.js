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
clickMarker.raycast = () => {}; // Disable raycasting on click marker
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
atmosphere.raycast = () => {}; // Disable raycasting on atmosphere
scene.add(atmosphere);

// Country outline object for highlighting selected countries
let countryOutline = null;

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
    
    // Only intersect with the globe mesh, not outline or other objects
    // Use recursive=false to avoid hitting child objects (like the outline)
    const intersects = raycaster.intersectObject(globe, false);
    
    console.log('Globe intersects found:', intersects.length); // Debug
    
    if (intersects.length > 0) {
        // Get the first valid intersection with the globe surface
        let intersection = intersects[0];
        
        // Validate intersection point is reasonable (within expected distance from origin)
        const distance = intersection.point.length();
        if (distance < 4.8 || distance > 5.2) { // Globe radius is 5, allow some margin
            console.warn('Intersection distance seems wrong:', distance, 'trying next intersection');
            if (intersects.length > 1) {
                intersection = intersects[1]; // Try second intersection
            }
        }
        
        const point = intersection.point;
        console.log('Using intersection point:', point, 'distance:', point.length().toFixed(3));
        
        // DEBUG: Try multiple coordinate conversion methods
        let uv = intersection.uv;
        const point3D = intersection.point;
        const normalized = point3D.clone().normalize();
        
        // Fallback UV calculation if not provided
        if (!uv) {
            // Calculate UV from 3D coordinates
            const lon = Math.atan2(-normalized.z, normalized.x);
            const lat = Math.asin(normalized.y);
            uv = {
                x: (lon / (2 * Math.PI)) + 0.5, // Convert -π,π to 0,1
                y: 0.5 - (lat / Math.PI) // Convert -π/2,π/2 to 1,0
            };
            console.log('UV not provided, calculated fallback:', uv);
        }
        
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
        
        // Create outline for the selected country
        createCountryOutline(country);
        
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
            geometry: country.geometry, // Include geometry for outline creation!
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

// Function to create country outline
function createCountryOutline(country) {
    console.log('Creating outline for country:', country.name);
    
    // Remove existing outline
    if (countryOutline) {
        globe.remove(countryOutline);
        
        // Clean up group contents
        if (countryOutline.children) {
            countryOutline.children.forEach(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        }
        
        countryOutline = null;
        console.log('Removed previous outline');
    }
    
    if (!country || !country.geometry || country.name === 'Ocean/International Waters') {
        console.log('No valid country for outline');
        return;
    }
    
    console.log('Country geometry type:', country.geometry.type);
    
    // Store original coordinates for multiple layer processing
    let allCoordinates = [];
    
    // Process country geometry to get coordinates
    if (country.geometry.type === 'Polygon') {
        allCoordinates = country.geometry.coordinates;
    } else if (country.geometry.type === 'MultiPolygon') {
        allCoordinates = country.geometry.coordinates.flat(); // Flatten all polygons
    }
    
    console.log('Processing', allCoordinates.length, 'coordinate sets');
    
    if (allCoordinates.length > 0) {
        // Create outline using multiple overlapping lines for thickness
        countryOutline = new THREE.Group();
        
        // Create multiple line layers for thickness effect
        const layers = [
            { radius: 5.08, color: 0x00ff88, opacity: 0.4 }, // Inner glow
            { radius: 5.09, color: 0x00ff88, opacity: 0.6 }, // Medium inner
            { radius: 5.10, color: 0x00ff88, opacity: 1.0 }, // Main line
            { radius: 5.11, color: 0x00ff88, opacity: 0.6 }, // Medium outer  
            { radius: 5.12, color: 0x00ff88, opacity: 0.4 }  // Outer glow
        ];
        
        layers.forEach(layer => {
            // Calculate vertices at this radius
            const layerVertices = [];
            
            allCoordinates.forEach(ring => {
                if (Array.isArray(ring) && ring.length > 0) {
                    for (let i = 0; i < ring.length - 1; i++) {
                        const [lon1, lat1] = ring[i];
                        const [lon2, lat2] = ring[i + 1];
                        
                        if (!isNaN(lat1) && !isNaN(lon1) && !isNaN(lat2) && !isNaN(lon2)) {
                            const pos1 = latLonToVector3(lat1, lon1, layer.radius);
                            const pos2 = latLonToVector3(lat2, lon2, layer.radius);
                            
                            layerVertices.push(pos1.x, pos1.y, pos1.z);
                            layerVertices.push(pos2.x, pos2.y, pos2.z);
                        }
                    }
                }
            });
            
            if (layerVertices.length > 0) {
                const layerGeometry = new THREE.BufferGeometry();
                layerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(layerVertices, 3));
                
                const layerMaterial = new THREE.LineBasicMaterial({
                    color: layer.color,
                    transparent: true,
                    opacity: layer.opacity,
                    depthTest: false,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending
                });
                
                const lineSegments = new THREE.LineSegments(layerGeometry, layerMaterial);
                
                // Make outline non-interactive for raycasting
                lineSegments.raycast = () => {}; // Disable raycasting on outline
                
                countryOutline.add(lineSegments);
            }
        });
        
        console.log('Created thick outline with', layers.length, 'layers');
        globe.add(countryOutline);
        console.log('Added outline to globe');
    } else {
        console.log('No vertices generated for outline');
    }
}

// Removed addPolygonVertices function - now using direct coordinate processing for multi-layer outlines

// Helper function to convert lat/lng to 3D vector
// This MUST match the coordinate system used in Method 3 click detection!
function latLonToVector3(lat, lon, radius = 5) {
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;
    
    // Match Method 3: lon3 = Math.atan2(-normalized.z, normalized.x)
    // This means: x = cos(lat) * cos(lon), y = sin(lat), z = -cos(lat) * sin(lon)
    const x = radius * Math.cos(latRad) * Math.cos(lonRad);
    const y = radius * Math.sin(latRad);
    const z = -radius * Math.cos(latRad) * Math.sin(lonRad); // Negative Z to match Method 3
    
    const result = new THREE.Vector3(x, y, z);
    
    // Minimal debug logging (remove this line to disable completely)
    // console.log('Coord conversion:', lat.toFixed(2), lon.toFixed(2), '→', result.x.toFixed(2), result.y.toFixed(2), result.z.toFixed(2));
    
    return result;
}

// Fetch weather data from Open-Meteo API
async function fetchWeatherData(lat, lng, isDaytime) {
    try {
        // Open-Meteo current weather API
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&timezone=auto`
        );
        
        if (!response.ok) {
            throw new Error(`Weather API response: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Weather data:', data);
        
        const current = data.current;
        
        // Weather code interpretation (WMO Weather interpretation codes)
        const weatherCodes = {
            0: '☀️ Clear sky',
            1: '🌤️ Mainly clear',
            2: '⛅ Partly cloudy',
            3: '☁️ Overcast',
            45: '🌫️ Fog',
            48: '🌫️ Depositing rime fog',
            51: '🌦️ Light drizzle',
            53: '🌦️ Moderate drizzle',
            55: '🌦️ Dense drizzle',
            61: '🌧️ Light rain',
            63: '🌧️ Moderate rain',
            65: '🌧️ Heavy rain',
            71: '🌨️ Light snow',
            73: '🌨️ Moderate snow',
            75: '❄️ Heavy snow',
            77: '🌨️ Snow grains',
            80: '🌦️ Light rain showers',
            81: '🌧️ Moderate rain showers',
            82: '⛈️ Violent rain showers',
            85: '🌨️ Light snow showers',
            86: '❄️ Heavy snow showers',
            95: '⛈️ Thunderstorm',
            96: '⛈️ Thunderstorm with hail',
            99: '⛈️ Thunderstorm with heavy hail'
        };
        
        const weatherDescription = weatherCodes[current.weather_code] || `☁️ Weather code ${current.weather_code}`;
        const temp = Math.round(current.temperature_2m);
        const feelsLike = Math.round(current.apparent_temperature);
        const humidity = current.relative_humidity_2m;
        const windSpeed = Math.round(current.wind_speed_10m);
        const windDir = getWindDirection(current.wind_direction_10m);
        
        // Create weather display
        const weatherHtml = `
            <div style="margin-bottom: 8px;">
                <strong>${weatherDescription}</strong>
            </div>
            <div style="font-size: 14px; color: #ccc; line-height: 1.4;">
                🌡️ ${temp}°C (feels like ${feelsLike}°C)<br>
                🍃 ${windSpeed} km/h ${windDir}<br>
                💧 ${humidity}% humidity
            </div>
        `;
        
        document.getElementById('weather-status').innerHTML = weatherHtml;
        
    } catch (error) {
        console.error('Weather fetch failed:', error);
        
        // Fallback to basic day/night status
        const basicStatus = isDaytime ? '☀️ Daytime' : '🌙 Nighttime';
        document.getElementById('weather-status').textContent = basicStatus;
    }
}

// Helper function to convert wind direction degrees to compass direction
function getWindDirection(degrees) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(degrees / 22.5) % 16;
    return directions[index];
}

// Helper function to get better search terms for each country
function getCountrySearchTerms(countryName) {
    const searchTerms = [countryName];
    
    // Add specific search terms for major countries to get more relevant results
    const countrySpecificTerms = {
        'Brazil': ['Brazil', 'Brazilian', 'Brasilia', 'Rio de Janeiro', 'São Paulo', 'Bolsonaro', 'Lula'],
        'Mexico': ['Mexico', 'Mexican', 'Mexico City', 'AMLO', 'López Obrador', 'Guadalajara', 'Monterrey'],
        'Australia': ['Australia', 'Australian', 'Sydney', 'Melbourne', 'Canberra', 'Albanese'],
        'Germany': ['Germany', 'German', 'Berlin', 'Munich', 'Hamburg', 'Scholz'],
        'France': ['France', 'French', 'Paris', 'Macron', 'Lyon', 'Marseille'],
        'United Kingdom': ['UK', 'Britain', 'British', 'London', 'England', 'Scotland', 'Wales'],
        'United States': ['USA', 'America', 'American', 'Washington', 'Biden', 'Trump'],
        'Japan': ['Japan', 'Japanese', 'Tokyo', 'Osaka', 'Kyoto'],
        'China': ['China', 'Chinese', 'Beijing', 'Shanghai', 'Xi Jinping'],
        'India': ['India', 'Indian', 'Delhi', 'Mumbai', 'Modi'],
        'Russia': ['Russia', 'Russian', 'Moscow', 'Putin', 'Kremlin'],
        'Canada': ['Canada', 'Canadian', 'Ottawa', 'Toronto', 'Trudeau'],
        'Italy': ['Italy', 'Italian', 'Rome', 'Milan', 'Vatican'],
        'Spain': ['Spain', 'Spanish', 'Madrid', 'Barcelona', 'Sánchez']
    };
    
    if (countrySpecificTerms[countryName]) {
        return countrySpecificTerms[countryName];
    }
    
    // For other countries, try to add the capital city and common variations
    const capitals = {
        'Netherlands': ['Netherlands', 'Dutch', 'Amsterdam', 'The Hague'],
        'Sweden': ['Sweden', 'Swedish', 'Stockholm'],
        'Norway': ['Norway', 'Norwegian', 'Oslo'],
        'Denmark': ['Denmark', 'Danish', 'Copenhagen'],
        'Finland': ['Finland', 'Finnish', 'Helsinki'],
        'Poland': ['Poland', 'Polish', 'Warsaw'],
        'Argentina': ['Argentina', 'Argentine', 'Buenos Aires'],
        'Chile': ['Chile', 'Chilean', 'Santiago'],
        'South Korea': ['Korea', 'Korean', 'Seoul', 'South Korea'],
        'Thailand': ['Thailand', 'Thai', 'Bangkok'],
        'Egypt': ['Egypt', 'Egyptian', 'Cairo'],
        'Turkey': ['Turkey', 'Turkish', 'Ankara', 'Istanbul'],
        'South Africa': ['South Africa', 'Cape Town', 'Johannesburg']
    };
    
    return capitals[countryName] || [countryName];
}

// Helper function to get date X days ago in YYYY-MM-DD format
function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
}

// Fetch news from WorldNewsAPI (better for location-based news)
async function fetchFromWorldNewsAPI(country, apiKey) {
    try {
        // WorldNewsAPI has better geographical search capabilities
        let searchQuery = country.name;
        
        // For better results, use both country name and major cities
        const searchTerms = getCountrySearchTerms(country.name);
        if (searchTerms.length > 1) {
            // Use first few most relevant terms to avoid overly long queries
            searchQuery = searchTerms.slice(0, 3).join(' OR ');
        }
        
        // WorldNewsAPI endpoint with location-based search
        const worldNewsUrl = `https://api.worldnewsapi.com/search-news?text=${encodeURIComponent(searchQuery)}&language=en&sort=publish-time&sort-direction=DESC&number=5&earliest-publish-date=${getDateDaysAgo(7)}&api-key=${apiKey}`;
        
        console.log('Fetching from WorldNewsAPI:', worldNewsUrl.replace(apiKey, 'API_KEY_HIDDEN'));
        
        const response = await fetch(worldNewsUrl);
        
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid WorldNewsAPI key');
            } else if (response.status === 402) {
                throw new Error('WorldNewsAPI quota exceeded');
            } else if (response.status === 429) {
                throw new Error('WorldNewsAPI rate limit exceeded');
            } else {
                throw new Error(`WorldNewsAPI error: ${response.status}`);
            }
        }
        
        const data = await response.json();
        console.log('WorldNewsAPI response:', data);
        
        if (!data.news || data.news.length === 0) {
            console.log('No articles found in WorldNewsAPI');
            return false;
        }
        
        // Filter for relevance - articles that actually mention the country
        const relevantArticles = data.news.filter(article => {
            const titleLower = (article.title || '').toLowerCase();
            const textLower = (article.text || '').toLowerCase();
            const contentText = titleLower + ' ' + textLower;
            
            // Check if article actually mentions the country or related terms
            const searchTermsLower = getCountrySearchTerms(country.name).map(term => term.toLowerCase());
            return searchTermsLower.some(term => 
                contentText.includes(term) ||
                contentText.includes(country.name.toLowerCase())
            );
        });
        
        console.log(`WorldNewsAPI: Found ${data.news.length} articles, ${relevantArticles.length} relevant`);
        
        if (relevantArticles.length === 0) {
            return false;
        }
        
        // Format articles for display
        const newsItems = relevantArticles.slice(0, 3).map(article => ({
            title: article.title,
            summary: article.text ? (article.text.length > 150 ? article.text.substring(0, 150) + '...' : article.text) : 'No description available',
            url: article.url,
            source: article.source_country ? `${article.source_country} News` : 'WorldNews',
            publishedAt: new Date(article.publish_time).toLocaleDateString()
        }));
        
        displayRealNews(newsItems);
        return true; // Success
        
    } catch (error) {
        console.error('WorldNewsAPI failed:', error);
        throw error; // Re-throw to trigger fallback
    }
}

// Fetch news from UN News RSS feeds (regional, reliable, no CORS issues!)
async function fetchNewsData(country) {
    try {
        // Set loading state
        document.getElementById('news-status').innerHTML = '📰 Loading UN News...';
        
        console.log('Looking for news for country:', country.name);
        
        // Skip news for ocean/international waters
        if (country.name === 'Ocean/International Waters') {
            document.getElementById('news-status').innerHTML = '🌊 No news available for international waters';
            return;
        }
        
        // Country-specific RSS feeds (higher quality, more targeted news)
        const countrySpecificFeeds = {
            'France': 'https://www.france24.com/en/france/rss',
            'United States': 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml',
            'United States of America': 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml',
            'USA': 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml',
            'US': 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml',
            'Australia': 'https://www.smh.com.au/rss/national.xml',
            'United Kingdom': 'https://feeds.bbci.co.uk/news/uk/rss.xml',
            'UK': 'https://feeds.bbci.co.uk/news/uk/rss.xml',
            'Great Britain': 'https://feeds.bbci.co.uk/news/uk/rss.xml',
            'Britain': 'https://feeds.bbci.co.uk/news/uk/rss.xml',
            'India': 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms',
            'Russia': 'https://www.rt.com/rss/russia/',
            'Russian Federation': 'https://www.rt.com/rss/russia/',
            'Uganda': 'https://www.watchdoguganda.com/feed',
            'China': 'https://www.scmp.com/rss/4/feed/',
            'Germany': 'https://www.spiegel.de/international/index.rss',
            'Japan': 'https://www.japantimes.co.jp/feed/',
            'Brazil': 'https://www.brasilwire.com/feed/',
            'Mexico': 'https://mexiconewsdaily.com/feed/',
            'Canada': 'https://www.cbc.ca/webfeed/rss/rss-canada',
            'Egypt': 'https://www.dailynewsegypt.com/feed/',
            'Argentina': 'https://www.batimes.com.ar/feed',
            'Chile': 'https://feeds.bignewsnetwork.com/category/2df0da68a00f4413',
            'South Korea': 'https://en.yna.co.kr/RSS/news.xml',
            'Korea, Republic of': 'https://en.yna.co.kr/RSS/news.xml',
            'Republic of Korea': 'https://en.yna.co.kr/RSS/news.xml',
            'Poland': 'https://notesfrompoland.com/feed/',
            'Saudi Arabia': 'https://saudigazette.com.sa/rssFeed/74',
            'Kingdom of Saudi Arabia': 'https://saudigazette.com.sa/rssFeed/74',
            'Iran': 'https://www.tehrantimes.com/rss',
            'Iraq': 'https://www.iraq-businessnews.com/feed/',
            'South Africa': 'https://mg.co.za/feed/',
            'Republic of South Africa': 'https://mg.co.za/feed/',
            'Malaysia': 'https://www.thestar.com.my/RSS/News/Nation/',
            'New Zealand': 'https://www.nzherald.co.nz/arc/outboundfeeds/rss/section/nz/?outputType=xml&_website=nzh',
            'Venezuela': 'https://www.caracaschronicles.com/feed/',
            'Nigeria': 'https://www.vanguardngr.com/feed/',
            'Thailand': 'https://www.bangkokpost.com/rss/data/thailand.xml',
            'Norway': 'https://www.regjeringen.no/en/rss/Rss/2581966/',
            'Sweden': 'https://www.riksgalden.se/en/press-and-publications/press-releases-and-news/?feed=RSS',
            'Finland': 'https://www.helsinkitimes.fi/?format=feed',
            'Netherlands': 'https://feeds.government.nl/news.rss',
            'Holland': 'https://feeds.government.nl/news.rss',
            'Turkey': 'https://www.dailysabah.com/rss/turkiye',
            'Türkiye': 'https://www.dailysabah.com/rss/turkiye'
        };
        
        // Check for country-specific feed first
        let rssUrl = countrySpecificFeeds[country.name];
        let feedSource = 'Country-Specific';
        
        if (rssUrl) {
            console.log(`Using country-specific RSS feed for ${country.name}:`, rssUrl);
        } else {
            // Fall back to UN News regional feeds
            feedSource = 'UN News';
            rssUrl = getUNRegionForCountry(country.name);
            console.log(`Using UN News regional RSS feed for ${country.name}:`, rssUrl);
        }
        
        // Map countries to UN News regional RSS feeds
        function getUNRegionForCountry(countryName) {
            const countryLower = countryName.toLowerCase();
            
            // Europe
            if (['united kingdom', 'uk', 'great britain', 'britain', 'france', 'germany', 'italy', 'spain', 'netherlands', 'belgium', 'switzerland', 'austria', 'portugal', 'greece', 'ireland', 'denmark', 'sweden', 'norway', 'finland', 'iceland', 'russia', 'russian federation', 'ukraine', 'poland', 'czech republic', 'czechia', 'hungary', 'romania', 'bulgaria', 'croatia', 'serbia', 'bosnia and herzegovina', 'slovenia', 'slovakia', 'estonia', 'latvia', 'lithuania', 'belarus', 'moldova', 'albania', 'north macedonia', 'montenegro', 'kosovo', 'luxembourg', 'malta', 'cyprus', 'liechtenstein', 'monaco', 'san marino', 'vatican city'].some(country => countryLower.includes(country) || country.includes(countryLower))) {
                return 'https://news.un.org/feed/subscribe/en/news/region/europe/feed/rss.xml';
            }
            
            // Middle East (including North Africa per UN classification)
            if (['turkey', 'iran', 'iraq', 'syria', 'lebanon', 'jordan', 'israel', 'palestine', 'saudi arabia', 'united arab emirates', 'uae', 'kuwait', 'qatar', 'bahrain', 'oman', 'yemen', 'egypt', 'libya', 'tunisia', 'algeria', 'morocco', 'western sahara'].some(country => countryLower.includes(country) || country.includes(countryLower))) {
                return 'https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml';
            }
            
            // Africa (Sub-Saharan)
            if (['south africa', 'nigeria', 'kenya', 'ethiopia', 'ghana', 'uganda', 'tanzania', 'zimbabwe', 'zambia', 'botswana', 'namibia', 'madagascar', 'rwanda', 'senegal', 'mali', 'burkina faso', 'niger', 'chad', 'cameroon', 'angola', 'mozambique', 'somalia', 'sudan', 'south sudan', 'democratic republic of congo', 'congo', 'gabon', 'equatorial guinea', 'central african republic', 'benin', 'togo', 'ivory coast', 'liberia', 'sierra leone', 'guinea', 'guinea-bissau', 'gambia', 'mauritania', 'cape verde', 'sao tome and principe', 'comoros', 'seychelles', 'mauritius', 'djibouti', 'eritrea', 'burundi', 'malawi', 'lesotho', 'swaziland', 'eswatini'].some(country => countryLower.includes(country) || country.includes(countryLower))) {
                return 'https://news.un.org/feed/subscribe/en/news/region/africa/feed/rss.xml';
            }
            
            // Americas (North, Central, South America, and Caribbean)
            if (['united states', 'usa', 'us', 'canada', 'mexico', 'brazil', 'argentina', 'chile', 'colombia', 'peru', 'venezuela', 'ecuador', 'bolivia', 'paraguay', 'uruguay', 'guatemala', 'honduras', 'el salvador', 'nicaragua', 'costa rica', 'panama', 'cuba', 'jamaica', 'haiti', 'dominican republic', 'puerto rico', 'trinidad and tobago', 'barbados', 'bahamas', 'belize', 'guyana', 'suriname', 'french guiana'].some(country => countryLower.includes(country) || country.includes(countryLower))) {
                return 'https://news.un.org/feed/subscribe/en/news/region/americas/feed/rss.xml';
            }
            
            // Asia Pacific (East Asia, South Asia, Southeast Asia, Central Asia, Oceania)
            if (['china', 'japan', 'south korea', 'north korea', 'taiwan', 'hong kong', 'mongolia', 'thailand', 'vietnam', 'cambodia', 'laos', 'myanmar', 'burma', 'philippines', 'indonesia', 'malaysia', 'singapore', 'brunei', 'timor-leste', 'east timor', 'india', 'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'bhutan', 'maldives', 'afghanistan', 'kazakhstan', 'uzbekistan', 'kyrgyzstan', 'tajikistan', 'turkmenistan', 'armenia', 'azerbaijan', 'georgia', 'australia', 'new zealand', 'papua new guinea', 'fiji', 'samoa', 'tonga', 'vanuatu', 'solomon islands', 'palau', 'micronesia', 'marshall islands', 'kiribati', 'tuvalu', 'nauru'].some(country => countryLower.includes(country) || country.includes(countryLower))) {
                return 'https://news.un.org/feed/subscribe/en/news/region/asia-pacific/feed/rss.xml';
            }
            
            // Default to Global feed for unmatched countries
            return 'https://news.un.org/feed/subscribe/en/news/region/global/feed/rss.xml';
        }
        
        // This section is now handled above in the country-specific check
        
        // Use CORS proxy to fetch UN News RSS feed
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(rssUrl)}`;
        console.log('Fetching via CORS proxy:', proxyUrl);
        
        const response = await fetch(proxyUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch UN News RSS via proxy: ${response.status} ${response.statusText}`);
        }
        
        if (!response.ok) {
            throw new Error(`Failed to fetch RSS: ${response.status} ${response.statusText}`);
        }
        
        const xmlText = await response.text();
        console.log('RSS XML received, length:', xmlText.length);
        
        // Parse XML using DOMParser
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        // Check for XML parsing errors
        const parseError = xmlDoc.getElementsByTagName('parsererror');
        if (parseError.length > 0) {
            throw new Error('Failed to parse RSS XML');
        }
        
        // Extract news items from XML
        const items = xmlDoc.getElementsByTagName('item');
        console.log('Found RSS items:', items.length);
        
        if (items.length === 0) {
            throw new Error('No news items found in RSS feed');
        }
        
        // Convert XML items to news format (take first 3)
        const newsItems = [];
        const itemsToProcess = Math.min(items.length, 3);
        
        for (let i = 0; i < itemsToProcess; i++) {
            const item = items[i];
            
            // Extract text content from XML elements
            const title = item.getElementsByTagName('title')[0]?.textContent || 'No title';
            const link = item.getElementsByTagName('link')[0]?.textContent || '#';
            const description = item.getElementsByTagName('description')[0]?.textContent || 'No description available';
            const pubDate = item.getElementsByTagName('pubDate')[0]?.textContent || '';
            
            // Clean up description (remove HTML tags and entities)
            const cleanDescription = description
                .replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .substring(0, 150);
            
            // Format date
            let formattedDate = 'Recent';
            if (pubDate) {
                try {
                    formattedDate = new Date(pubDate).toLocaleDateString();
                } catch (e) {
                    formattedDate = 'Recent';
                }
            }
            
            // Determine source name based on feed type
            let sourceName = feedSource === 'Country-Specific' ? getSourceNameFromUrl(rssUrl) : 'UN News';
            
            newsItems.push({
                title: title,
                summary: cleanDescription,
                url: link,
                source: sourceName,
                publishedAt: formattedDate
            });
        }
        
        console.log('Processed news items:', newsItems.length);
        
        displayRealNews(newsItems);
        
    } catch (error) {
        console.error('News RSS fetch failed:', error);
        
        // Fallback to mock news if RSS fails
        console.log('Falling back to mock news data');
        const mockNews = generateMockNews(country.name);
        displayNews(mockNews);
        
        // Show error message briefly
        setTimeout(() => {
            document.getElementById('news-status').innerHTML += 
                '<div style="font-size: 10px; color: #666; margin-top: 8px; font-style: italic;">Using sample data - News RSS temporarily unavailable</div>';
        }, 1000);
    }
}

// Helper function to extract source name from RSS URL
function getSourceNameFromUrl(url) {
    const sourceMap = {
        'france24.com': 'France 24',
        'nytimes.com': 'NY Times',
        'smh.com.au': 'Sydney Morning Herald',
        'bbci.co.uk': 'BBC News',
        'timesofindia.indiatimes.com': 'Times of India',
        'rt.com': 'RT News',
        'watchdoguganda.com': 'Watchdog Uganda',
        'scmp.com': 'South China Morning Post',
        'spiegel.de': 'Der Spiegel',
        'japantimes.co.jp': 'Japan Times',
        'brasilwire.com': 'Brasil Wire',
        'mexiconewsdaily.com': 'Mexico News Daily',
        'cbc.ca': 'CBC News',
        'dailynewsegypt.com': 'Daily News Egypt',
        'batimes.com.ar': 'Buenos Aires Times',
        'bignewsnetwork.com': 'Big News Network',
        'yna.co.kr': 'Yonhap News',
        'notesfrompoland.com': 'Notes From Poland',
        'saudigazette.com.sa': 'Saudi Gazette',
        'tehrantimes.com': 'Tehran Times',
        'iraq-businessnews.com': 'Iraq Business News',
        'mg.co.za': 'Mail & Guardian',
        'thestar.com.my': 'The Star Malaysia',
        'nzherald.co.nz': 'NZ Herald',
        'caracaschronicles.com': 'Caracas Chronicles',
        'vanguardngr.com': 'Vanguard Nigeria',
        'bangkokpost.com': 'Bangkok Post',
        'regjeringen.no': 'Government Norway',
        'riksgalden.se': 'Swedish National Debt Office',
        'helsinkitimes.fi': 'Helsinki Times',
        'government.nl': 'Government Netherlands',
        'dailysabah.com': 'Daily Sabah'
    };
    
    for (const [domain, name] of Object.entries(sourceMap)) {
        if (url.includes(domain)) {
            return name;
        }
    }
    
    return 'News Source';
}

// Generate representative mock news for demo purposes
function generateMockNews(countryName) {
    const newsTemplates = {
        'United States': [
            { title: 'Congress Passes New Infrastructure Bill', summary: 'Major investments in transportation and broadband announced.' },
            { title: 'Tech Sector Shows Strong Growth', summary: 'Silicon Valley companies report record quarterly earnings.' },
            { title: 'Climate Initiative Launched', summary: 'Federal program aims to reduce carbon emissions by 2030.' }
        ],
        'United Kingdom': [
            { title: 'Parliament Debates New Housing Policy', summary: 'MPs discuss affordable housing initiatives across the UK.' },
            { title: 'Royal Family Makes Public Appearance', summary: 'Charity event raises millions for local causes.' },
            { title: 'Brexit Trade Relations Update', summary: 'New agreements signed with European partners.' }
        ],
        'Germany': [
            { title: 'Renewable Energy Milestone Reached', summary: 'Wind and solar power hit new generation records.' },
            { title: 'Automotive Industry Innovation', summary: 'German carmakers unveil new electric vehicle models.' },
            { title: 'European Union Summit Begins', summary: 'Leaders gather in Berlin for economic discussions.' }
        ],
        'France': [
            { title: 'Cultural Festival Draws Millions', summary: 'Paris hosts international arts and music celebration.' },
            { title: 'Agricultural Sector Modernization', summary: 'New technology initiatives support French farmers.' },
            { title: 'Space Program Achievements', summary: 'ESA mission launches successfully from French Guiana.' }
        ],
        'Japan': [
            { title: 'Technology Innovation Showcase', summary: 'Tokyo exhibition features latest robotics advances.' },
            { title: 'Sustainable Tourism Initiative', summary: 'New programs promote eco-friendly travel options.' },
            { title: 'Cherry Blossom Festival Updates', summary: 'Record visitors expected for this years hanami season.' }
        ],
        'China': [
            { title: 'Economic Growth Targets Announced', summary: 'Government outlines development plans for next quarter.' },
            { title: 'High-Speed Rail Expansion', summary: 'New connections link major cities across the country.' },
            { title: 'Environmental Protection Measures', summary: 'New policies address air quality and conservation.' }
        ],
        'default': [
            { title: `${countryName} Economic Update`, summary: 'Local markets show positive growth trends this quarter.' },
            { title: `Cultural Events in ${countryName}`, summary: 'Traditional festivals and modern celebrations planned.' },
            { title: `${countryName} International Relations`, summary: 'Diplomatic ties strengthened with neighboring countries.' }
        ]
    };
    
    return newsTemplates[countryName] || newsTemplates['default'];
}

// Display real news from NewsAPI with enhanced formatting
function displayRealNews(newsItems) {
    let newsHtml = '';
    
    newsItems.forEach((item, index) => {
        // Truncate long titles and summaries
        const maxTitleLength = 60;
        const maxSummaryLength = 120;
        
        const truncatedTitle = item.title.length > maxTitleLength 
            ? item.title.substring(0, maxTitleLength) + '...' 
            : item.title;
            
        const truncatedSummary = item.summary.length > maxSummaryLength 
            ? item.summary.substring(0, maxSummaryLength) + '...' 
            : item.summary;
        
        newsHtml += `
            <div style="margin-bottom: ${index < newsItems.length - 1 ? '12px' : '0'}; padding-bottom: ${index < newsItems.length - 1 ? '10px' : '0'}; ${index < newsItems.length - 1 ? 'border-bottom: 1px solid rgba(68, 136, 255, 0.2);' : ''}">
                <div style="font-weight: bold; font-size: 13px; color: #4488ff; margin-bottom: 4px; cursor: pointer;" onclick="window.open('${item.url}', '_blank')" title="Click to read full article">
                    📰 ${truncatedTitle}
                </div>
                <div style="font-size: 11px; color: #aaa; line-height: 1.3; margin-bottom: 4px;">
                    ${truncatedSummary}
                </div>
                <div style="font-size: 9px; color: #666; display: flex; justify-content: space-between;">
                    <span>📅 ${item.publishedAt}</span>
                    <span>🏢 ${item.source}</span>
                </div>
            </div>
        `;
    });
    
    document.getElementById('news-status').innerHTML = newsHtml;
}

// Display news in the sidebar (fallback for mock data)
function displayNews(newsItems) {
    let newsHtml = '';
    
    newsItems.forEach((item, index) => {
        newsHtml += `
            <div style="margin-bottom: ${index < newsItems.length - 1 ? '12px' : '0'}; padding-bottom: ${index < newsItems.length - 1 ? '8px' : '0'}; ${index < newsItems.length - 1 ? 'border-bottom: 1px solid rgba(68, 136, 255, 0.2);' : ''}">
                <div style="font-weight: bold; font-size: 13px; color: #4488ff; margin-bottom: 4px;">
                    📰 ${item.title}
                </div>
                <div style="font-size: 11px; color: #aaa; line-height: 1.3;">
                    ${item.summary}
                </div>
            </div>
        `;
    });
    
    document.getElementById('news-status').innerHTML = newsHtml;
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
    
    // Set initial weather status
    document.getElementById('weather-status').textContent = 'Loading weather...';
    document.getElementById('news-status').textContent = 'Loading news...';
    
    // Fetch weather data from Open-Meteo
    fetchWeatherData(clickLat, clickLng, isDaytime);
    
    // Fetch news data for the country
    fetchNewsData(country);
        
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

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.remove('open');
        console.log('Sidebar closed'); // Debug
    }
    
    // Clear country outline when closing sidebar
    if (countryOutline) {
        globe.remove(countryOutline);
        
        // Clean up group contents
        if (countryOutline.children) {
            countryOutline.children.forEach(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        }
        
        countryOutline = null;
    }
    
    // Hide click marker as well
    if (clickMarker) {
        clickMarker.visible = false;
    }
}

// Make functions globally accessible
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;

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
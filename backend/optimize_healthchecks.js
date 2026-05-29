const fs = require('fs');
const yaml = require('yaml');

const filesToOptimize = [
  '/root/supabase/docker/docker-compose.yml',
  '/root/print_lankaDB/docker-compose.yml',
  '/opt/supabase-projects/motion-v1/docker-compose.yml'
];

for (const filepath of filesToOptimize) {
  if (!fs.existsSync(filepath)) {
    console.log(`File not found: ${filepath}`);
    continue;
  }
  
  console.log(`Optimizing healthchecks in ${filepath}...`);
  try {
    const composeTxt = fs.readFileSync(filepath, 'utf8');
    const doc = yaml.parseDocument(composeTxt);
    const services = doc.get('services');
    
    if (!services || !services.items) {
      console.log(`  No services found in ${filepath}`);
      continue;
    }
    
    let count = 0;
    for (const item of services.items) {
      const serviceName = item.key.value;
      const service = item.value;
      
      // 1. Optimize healthcheck parameters
      const healthcheck = service.get('healthcheck');
      if (healthcheck) {
        healthcheck.set('interval', '30s');
        healthcheck.set('timeout', '10s');
        healthcheck.set('retries', 3);
        healthcheck.set('start_period', '60s');
        
        // 2. Fix specific container healthcheck localhost / IP bindings
        if (serviceName === 'analytics') {
          // Logflare needs 127.0.0.1 instead of localhost to bypass IPv6 DNS bugs in some containers
          healthcheck.set('test', doc.createNode(["CMD", "curl", "http://127.0.0.1:4000/health"]));
        } else if (serviceName === 'storage') {
          // Storage needs 127.0.0.1 explicitly to connect correctly
          healthcheck.set('test', doc.createNode([
            "CMD",
            "wget",
            "--no-verbose",
            "--tries=1",
            "--spider",
            "http://127.0.0.1:5000/status"
          ]));
        } else if (serviceName === 'auth') {
          // Auth needs 127.0.0.1 to avoid IPv6 localhost bugs
          healthcheck.set('test', doc.createNode([
            "CMD",
            "wget",
            "--no-verbose",
            "--tries=1",
            "--spider",
            "http://127.0.0.1:9999/health"
          ]));
        }
        count++;
      }
      
      // 3. Increase memory limit for analytics to prevent compilation OOM
      if (serviceName === 'analytics') {
        const deploy = service.get('deploy');
        if (deploy) {
          const resources = deploy.get('resources');
          if (resources) {
            const limits = resources.get('limits');
            if (limits) {
              limits.set('memory', '1024M');
              console.log(`  Increased analytics memory limit to 1024M in ${filepath}`);
            }
          }
        }
      }
    }
    
    fs.writeFileSync(filepath, doc.toString(), 'utf8');
    console.log(`  Successfully optimized ${count} services in ${filepath}`);
  } catch (e) {
    console.error(`  Error optimizing ${filepath}:`, e.message);
  }
}
console.log('Optimization script completed!');

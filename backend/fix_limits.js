const fs = require('fs');
const yaml = require('yaml');

const files = [
  '/root/print_lankaDB/docker-compose.yml',
  '/opt/supabase-projects/motion-v1/docker-compose.yml'
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log('Not found:', file);
    continue;
  }
  const content = fs.readFileSync(file, 'utf8');
  const doc = yaml.parseDocument(content);
  
  if (doc.has('services')) {
    const services = doc.get('services');
    for (const item of services.items) {
      const serviceName = item.key.value;
      const service = item.value;
      
      let memoryLimit = '256M';
      if (serviceName === 'db') memoryLimit = '1024M';
      else if (serviceName === 'analytics') memoryLimit = '1024M';
      else if (serviceName === 'studio') memoryLimit = '1024M';
      else if (serviceName === 'kong') memoryLimit = '1024M';
      else if (serviceName === 'vector') memoryLimit = '128M';
      else if (serviceName === 'logflare') memoryLimit = '1024M';
      else if (serviceName === 'meta') memoryLimit = '256M';
      else if (serviceName === 'storage') memoryLimit = '256M';
      
      service.set('deploy', doc.createNode({
        resources: {
          limits: {
            memory: memoryLimit
          }
        }
      }));
      
      if (serviceName === 'db') {
        service.set('command', doc.createNode([
          "postgres",
          "-c", "config_file=/etc/postgresql/postgresql.conf",
          "-c", "log_min_messages=fatal",
          "-c", "shared_buffers=128MB",
          "-c", "work_mem=4MB",
          "-c", "effective_cache_size=512MB",
          "-c", "max_connections=60",
          "-c", "maintenance_work_mem=64MB"
        ]));
      }
    }
    fs.writeFileSync(file, doc.toString(), 'utf8');
    console.log('Successfully patched limits in:', file);
  }
}

const fs = require('fs');
const yaml = require('yaml');

const patchMap = {
  '/root/print_lankaDB/docker-compose.yml': { studio: '512M', kong: '512M' },
  '/opt/supabase-projects/motion-v1/docker-compose.yml': { studio: '512M', kong: '512M' },
};

for (const [file, patches] of Object.entries(patchMap)) {
  if (!fs.existsSync(file)) { console.log('Not found:', file); continue; }

  const content = fs.readFileSync(file, 'utf8');
  const doc = yaml.parseDocument(content);
  const services = doc.get('services');

  for (const item of services.items) {
    const name = item.key.value;
    const svc = item.value;
    if (!patches[name]) continue;

    // update or create deploy block
    const currentDeploy = svc.get('deploy');
    svc.set('deploy', doc.createNode({
      resources: { limits: { memory: patches[name] } }
    }));
    console.log(`Patched ${name} → ${patches[name]} in ${file}`);
  }

  fs.writeFileSync(file, doc.toString(), 'utf8');
}
console.log('Done!');

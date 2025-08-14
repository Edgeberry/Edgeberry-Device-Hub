// provisioning-service CLI

async function main() {
  const service = 'provisioning-service';
  console.log(`[${service}] hello world`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

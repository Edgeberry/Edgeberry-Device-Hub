// registry-service CLI

async function main() {
  const service = 'registry-service';
  console.log(`[${service}] hello world`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

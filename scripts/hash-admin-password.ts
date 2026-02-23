import { hashPassword } from "../functions/api/auth/_utils.ts";

async function main() {
  const password = process.argv[2] || "";
  if (!password) {
    console.error('Usage: node scripts/hash-admin-password.ts "MyPassword123!"');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  console.log(hash);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

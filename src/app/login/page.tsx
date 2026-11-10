import { AdministratorLogin } from '@/components/AdministratorLogin';

export const dynamic = 'force-dynamic';
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <AdministratorLogin nextPath={typeof query.next === 'string' ? query.next : undefined} />;
}

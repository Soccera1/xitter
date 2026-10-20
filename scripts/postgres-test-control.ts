// Native PostgreSQL control connections for backend-specific lock/race tests.
// Application traffic continues through the shared query layer.
import { SQL } from "bun";
export async function reservePostgres() {
	const pool = new SQL(process.env.DATABASE_URL!, { max: 1 });
	try {
		const connection = await pool.reserve();
		const release = connection.release.bind(connection);
		connection.release = () => {
			release();
			void pool.close();
		};
		return connection;
	} catch (error) {
		await pool.close();
		throw error;
	}
}

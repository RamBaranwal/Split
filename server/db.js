import mongoose from 'mongoose';
import { Group, Member } from './models.js';

let isConnected = false;

export async function getDb() {
  if (!isConnected) {
    const mongodbUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/spreetree';
    try {
      await mongoose.connect(mongodbUri);
      isConnected = true;
      console.log(`Connected to MongoDB at ${mongodbUri}`);
    } catch (err) {
      console.error('Failed to connect to MongoDB', err);
      throw err;
    }
  }
  return mongoose.connection;
}

export async function seedGroup(database) {
  await getDb();

  const groupName = 'Spreetree Flat';
  let group = await Group.findOne({ name: groupName });
  if (group) return group._id;

  group = await Group.create({ name: groupName, base_currency: 'INR' });
  const groupId = group._id;

  const members = [
    { name: 'Aisha', joinDate: '2026-02-01', leaveDate: null, aliases: ['aisha'] },
    { name: 'Rohan', joinDate: '2026-02-01', leaveDate: null, aliases: ['rohan', 'rohan '] },
    { name: 'Priya', joinDate: '2026-02-01', leaveDate: null, aliases: ['priya', 'priya s'] },
    { name: 'Meera', joinDate: '2026-02-01', leaveDate: '2026-03-31', aliases: ['meera'] },
    { name: 'Dev', joinDate: '2026-02-08', leaveDate: '2026-03-14', aliases: ['dev'] },
    { name: 'Sam', joinDate: '2026-04-10', leaveDate: null, aliases: ['sam'] },
    { name: 'Kabir', joinDate: '2026-03-11', leaveDate: '2026-03-11', aliases: ['kabir', "dev's friend kabir"] }
  ];

  for (const m of members) {
    await Member.create({
      group_id: groupId,
      name: m.name,
      join_date: m.joinDate,
      leave_date: m.leaveDate,
      aliases: m.aliases
    });
  }

  console.log('Successfully seeded default group and members in MongoDB.');
  return groupId;
}

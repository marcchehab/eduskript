#!/usr/bin/env npx tsx
/**
 * Test Script: Allow Anonymous Class Toggle Feature
 *
 * This script sets up test data and provides instructions for manual testing
 * of the anonymous class toggle feature.
 *
 * Usage: npx tsx scripts/test-anonymous-toggle.ts
 */

// Load environment variables FIRST before any other imports
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import crypto from 'crypto'

// Dynamic import to ensure env vars are loaded first
const { prisma } = await import('../src/lib/prisma.js')

// Helper to generate pseudonym (matches src/lib/privacy/pseudonym.ts)
function generatePseudonym(email: string): string {
  const secret = process.env.STUDENT_PSEUDONYM_SECRET || 'dev-secret-change-in-production'
  return crypto.createHmac('sha256', secret).update(email.toLowerCase().trim()).digest('hex')
}

// Helper to generate invite code
function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase()
}

interface TestData {
  teacherId: string
  teacherEmail: string
  anonymousClassId: string
  anonymousClassCode: string
  nonAnonymousClassId: string
  nonAnonymousClassCode: string
  preAuthStudentEmail: string
  preAuthStudentPseudonym: string
}

async function setupTestData(): Promise<TestData> {
  console.log('\n🔧 Setting up test data...\n')

  // 1. Find existing eduadmin teacher (by email or by their Site slug)
  const teacher = await prisma.user.findFirst({
    where: {
      OR: [
        { email: 'eduadmin@eduskript.org' },
        { sites: { some: { slug: 'eduadmin' } } },
      ]
    },
    include: { sites: { where: { slug: 'eduadmin' }, take: 1, select: { slug: true } } }
  })

  if (!teacher) {
    console.error('❌ Could not find eduadmin user. Please ensure the eduadmin account exists.')
    process.exit(1)
  }

  const teacherEmail = teacher.email || 'eduadmin'
  console.log('✅ Using existing teacher:', teacherEmail, '(pageSlug:', teacher.sites[0]?.slug + ')')

  // 2. Create anonymous class (allowAnonymous = true)
  const anonymousClassCode = generateInviteCode()
  const anonymousClass = await prisma.class.create({
    data: {
      name: '🟢 Anonymous Allowed Class',
      description: 'This class allows anonymous students. Anyone with the link can join.',
      teacherId: teacher.id,
      inviteCode: anonymousClassCode,
      isActive: true,
      allowAnonymous: true
    }
  })
  console.log('✅ Created anonymous class with invite code:', anonymousClassCode)

  // 3. Create non-anonymous class (allowAnonymous = false)
  const nonAnonymousClassCode = generateInviteCode()
  const nonAnonymousClass = await prisma.class.create({
    data: {
      name: '🔴 Identity Required Class',
      description: 'This class requires teacher approval. Only pre-authorized students can join.',
      teacherId: teacher.id,
      inviteCode: nonAnonymousClassCode,
      isActive: true,
      allowAnonymous: false
    }
  })
  console.log('✅ Created non-anonymous class with invite code:', nonAnonymousClassCode)

  // 4. Pre-authorize a student for the non-anonymous class
  const preAuthStudentEmail = 'preauth-student@school.edu'
  const preAuthStudentPseudonym = generatePseudonym(preAuthStudentEmail)

  await prisma.preAuthorizedStudent.upsert({
    where: {
      classId_pseudonym: {
        classId: nonAnonymousClass.id,
        pseudonym: preAuthStudentPseudonym
      }
    },
    create: {
      classId: nonAnonymousClass.id,
      pseudonym: preAuthStudentPseudonym
    },
    update: {}
  })
  console.log('✅ Pre-authorized student email:', preAuthStudentEmail)
  console.log('   Pseudonym:', preAuthStudentPseudonym.slice(0, 16) + '...')

  return {
    teacherId: teacher.id,
    teacherEmail,
    anonymousClassId: anonymousClass.id,
    anonymousClassCode,
    nonAnonymousClassId: nonAnonymousClass.id,
    nonAnonymousClassCode,
    preAuthStudentEmail,
    preAuthStudentPseudonym
  }
}

function printTestInstructions(data: TestData) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    ANONYMOUS CLASS TOGGLE - TEST SCRIPT                      ║
╚══════════════════════════════════════════════════════════════════════════════╝

📋 TEST DATA CREATED
────────────────────
Teacher Email:           ${data.teacherEmail}
Anonymous Class Code:    ${data.anonymousClassCode}
Non-Anonymous Class Code: ${data.nonAnonymousClassCode}
Pre-Auth Student Email:  ${data.preAuthStudentEmail}

════════════════════════════════════════════════════════════════════════════════
                              TEST SCENARIOS
════════════════════════════════════════════════════════════════════════════════

┌──────────────────────────────────────────────────────────────────────────────┐
│ SCENARIO 1: Teacher Dashboard - Toggle Visibility                            │
└──────────────────────────────────────────────────────────────────────────────┘

1. Sign in as a teacher at: ${baseUrl}/auth/signin
2. Go to Classes dashboard: ${baseUrl}/dashboard/classes
3. Expand any class to see the "Allow anonymous students" toggle
4. Toggle should show:
   - ON:  "Anyone with the invite link can join this class"
   - OFF: "Only students you add by email can join this class"

Expected: Toggle switches and text updates immediately


┌──────────────────────────────────────────────────────────────────────────────┐
│ SCENARIO 2: Anonymous Class - Any Student Can Join                           │
└──────────────────────────────────────────────────────────────────────────────┘

Join URL: ${baseUrl}/classes/join/${data.anonymousClassCode}

1. Open an incognito window (or sign out)
2. Navigate to the join URL above
3. You should see:
   - Class name: "🟢 Anonymous Allowed Class"
   - "Sign In to Join" button
4. Sign in with any OAuth account (Google/GitHub)
5. After sign-in, you should see:
   - Optional checkbox: "Share my identity with the teacher"
   - "Join This Class" button (enabled without checking box)
6. Join WITHOUT checking the identity box
7. Verify success message

Expected: Student joins anonymously, identity NOT revealed to teacher


┌──────────────────────────────────────────────────────────────────────────────┐
│ SCENARIO 3: Anonymous Class - Student Chooses to Reveal Identity             │
└──────────────────────────────────────────────────────────────────────────────┘

Join URL: ${baseUrl}/classes/join/${data.anonymousClassCode}

1. Use a different OAuth account than Scenario 2
2. Navigate to the join URL
3. Sign in and check the "Share my identity" checkbox
4. Join the class

Expected: Student joins with identity revealed to teacher


┌──────────────────────────────────────────────────────────────────────────────┐
│ SCENARIO 4: Non-Anonymous Class - NOT Pre-Authorized (BLOCKED)               │
└──────────────────────────────────────────────────────────────────────────────┘

Join URL: ${baseUrl}/classes/join/${data.nonAnonymousClassCode}

1. Use an OAuth account that is NOT ${data.preAuthStudentEmail}
2. Navigate to the join URL
3. You should see:
   - Class name: "🔴 Identity Required Class"
   - Amber warning box: "Teacher approval required"
   - Message: "This class requires your teacher to add your email..."
   - Your OAuth email displayed for sharing with teacher
   - NO "Join" button visible

Expected: Student is BLOCKED, sees their email to share with teacher


┌──────────────────────────────────────────────────────────────────────────────┐
│ SCENARIO 5: Non-Anonymous Class - Pre-Authorized Student                     │
└──────────────────────────────────────────────────────────────────────────────┘

Join URL: ${baseUrl}/classes/join/${data.nonAnonymousClassCode}

To test this scenario, you need to sign in with: ${data.preAuthStudentEmail}

If you can't use that specific email, you can pre-authorize your own email:

  Run in psql or database tool:

  INSERT INTO pre_authorized_students (id, class_id, pseudonym, added_at)
  VALUES (
    'preauth-manual-test',
    '${data.nonAnonymousClassId}',
    '<your-pseudonym>',  -- Get from generatePseudonym('your-email@example.com')
    NOW()
  );

When signed in as a pre-authorized student:
1. Navigate to the join URL
2. You should see:
   - Green confirmation box: "Your teacher has added you"
   - Message: "By joining, your teacher will be able to identify you"
   - "Join This Class" button (enabled, consent is implicit)
3. Click "Join This Class"

Expected: Student joins, identity revealed to teacher


┌──────────────────────────────────────────────────────────────────────────────┐
│ SCENARIO 6: Student Dashboard - Pending Invitations                          │
└──────────────────────────────────────────────────────────────────────────────┘

My Classes URL: ${baseUrl}/dashboard/my-classes

1. Sign in as a pre-authorized student (see Scenario 5)
2. Navigate to My Classes
3. Under "Class Invitations" section, you should see:
   - The non-anonymous class with "Identity required" badge
   - Message: "Teacher [Name] has asked you to join this class"
   - "Join Class" button
4. Click "Join Class"

Expected: Student joins from dashboard, confirmation shown


┌──────────────────────────────────────────────────────────────────────────────┐
│ SCENARIO 7: Toggle Class Setting (Teacher)                                   │
└──────────────────────────────────────────────────────────────────────────────┘

1. Sign in as a teacher
2. Go to Classes dashboard: ${baseUrl}/dashboard/classes
3. Find a class and toggle "Allow anonymous students" OFF
4. Copy the invite link
5. Open incognito, sign in as a student
6. Try to join - should be BLOCKED
7. Go back to teacher, toggle ON
8. Refresh student page - should now be able to join

Expected: Toggle change immediately affects join eligibility


════════════════════════════════════════════════════════════════════════════════
                              API TESTING (curl)
════════════════════════════════════════════════════════════════════════════════

# Preview anonymous class (no auth required)
curl -s ${baseUrl}/api/classes/join/${data.anonymousClassCode} | jq

# Preview non-anonymous class
curl -s ${baseUrl}/api/classes/join/${data.nonAnonymousClassCode} | jq

# Expected response structure:
# {
#   "class": {
#     "name": "...",
#     "allowAnonymous": true/false,
#     ...
#   },
#   "isPreAuthorized": true/false,
#   "isAlreadyMember": true/false
# }


════════════════════════════════════════════════════════════════════════════════
                              CLEANUP
════════════════════════════════════════════════════════════════════════════════

To clean up test data, run:

  DELETE FROM class_memberships WHERE class_id IN (
    SELECT id FROM classes WHERE teacher_id = '${data.teacherId}'
  );
  DELETE FROM pre_authorized_students WHERE class_id IN (
    SELECT id FROM classes WHERE teacher_id = '${data.teacherId}'
  );
  DELETE FROM classes WHERE teacher_id = '${data.teacherId}';
  DELETE FROM users WHERE id = '${data.teacherId}';


════════════════════════════════════════════════════════════════════════════════
`)
}

// Helper to generate a pseudonym for manual testing
function printPseudonymHelper() {
  console.log(`
────────────────────────────────────────────────────────────────────────────────
HELPER: Generate pseudonym for your email
────────────────────────────────────────────────────────────────────────────────

To pre-authorize your own email for testing, you need its pseudonym.

Run this command with your email:

  STUDENT_PSEUDONYM_SECRET="${process.env.STUDENT_PSEUDONYM_SECRET || 'dev-secret-change-in-production'}" \\
  npx tsx -e "
    const crypto = require('crypto');
    const email = 'YOUR_EMAIL@example.com';  // <-- Change this
    const secret = process.env.STUDENT_PSEUDONYM_SECRET;
    const pseudonym = crypto.createHmac('sha256', secret).update(email.toLowerCase().trim()).digest('hex');
    console.log('Email:', email);
    console.log('Pseudonym:', pseudonym);
  "

Then insert into the database as shown in Scenario 5.
────────────────────────────────────────────────────────────────────────────────
`)
}

async function main() {
  console.log('🚀 Anonymous Class Toggle - Test Setup\n')

  try {
    const testData = await setupTestData()
    printTestInstructions(testData)
    printPseudonymHelper()

    console.log('✅ Test setup complete!\n')
  } catch (error) {
    console.error('❌ Error setting up test data:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

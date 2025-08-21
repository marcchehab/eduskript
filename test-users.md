# Test Users

## Login Credentials

All test users have the same password: **`test123`**

### Test Accounts

| Name | Email | Title | Subdomain |
|------|-------|-------|-----------|
| Dr. Sarah Johnson | `sarah@informatikgarten.ch` | Mathematics Teacher | `sarah` |
| Prof. Michael Chen | `michael@informatikgarten.ch` | Physics Professor | `michael` |
| Dr. Emily Rodriguez | `emily@informatikgarten.ch` | Computer Science Teacher | `emily` |

## Usage

1. Navigate to `/auth/signin`
2. Use any of the email addresses above
3. Password: `test123`
4. All accounts are verified and ready to use

## Test Data

The database is seeded with:
- **Collection**: "Algebra Basics" (authored by Sarah)
- **Skripts**: "Introduction to Variables" and "Solving Linear Equations" 
- **Pages**: 3 sample pages with mathematical content
- All test users can collaborate with each other using the collaboration system

## Collaboration Testing

You can test the collaboration features by:
1. Sign in as one user
2. Go to `/dashboard/collaborate` 
3. Search for other test users
4. Send collaboration requests
5. Sign in as another user to accept/reject requests
6. Test the permission system with collections and skripts
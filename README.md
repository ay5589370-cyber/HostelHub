# 🏨 HostelHub – Smart Hostel Management System

HostelHub is a modern web-based hostel management system designed to simplify hostel administration and improve communication between students and hostel administrators.

Built using **React, Vite, and Supabase**, the platform provides student authentication, student record management, hostel room allocation, and a digital leave request system.

## ✨ Features

### 👨‍💼 Admin Panel
- Secure admin authentication.
- Create and manage student records.
- Automatic student ID generation.
- Manage student admission information.
- Manage hostel rooms and bed allocations.
- View student information and profiles.
- Manage day-out and night-out requests.
- Approve or reject student leave applications.

### 🎓 Student Panel
- Secure student login.
- Personalized student dashboard.
- View student profile and hostel information.
- Apply for day-out requests.
- Apply for night-out requests.
- Track leave application status.
- View leave history and admin remarks.
- Manage student account and password setup.

### 🔐 Security
- Supabase Authentication.
- PostgreSQL database.
- Row Level Security (RLS).
- Role-based access control.
- Protected student information.
- Secure file storage policies.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| React.js | Frontend |
| Vite | Development and build tool |
| JavaScript | Application logic |
| Supabase Auth | Authentication |
| PostgreSQL | Database |
| Supabase Storage | File storage |
| Supabase Edge Functions | Server-side operations |
| CSS | UI styling |

## 🏗️ Project Architecture

```text
HostelHub/
│
├── src/
│   ├── components/
│   ├── pages/
│   ├── routes/
│   ├── services/
│   ├── hooks/
│   └── assets/
│
├── supabase/
│   ├── migrations/
│   └── functions/
│
├── public/
├── package.json
└── README.md
```

*The directory structure may vary depending on the current implementation.*

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/HostelHub.git
```

### 2. Navigate to Project Directory

```bash
cd HostelHub
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the project root and configure your Supabase credentials:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Configure any required server-side secrets separately through the appropriate secure Supabase environment.

**Never expose your Supabase service-role key in frontend environment variables.**

### 5. Start Development Server

```bash
npm run dev
```

Open the local URL displayed in your terminal.

### 6. Build for Production

```bash
npm run build
```

## 🔄 Application Workflow

1. Admin logs into the admin panel.
2. Admin registers a student.
3. The system generates a unique student ID.
4. Student receives account access and logs in.
5. Student views their hostel information.
6. Student submits a day-out or night-out request.
7. Admin reviews and processes the request.
8. Student can track the updated application status.

## 🔮 Future Enhancements

- Parent notification system.
- Advanced attendance management.
- Hostel fee management.
- Online payment integration.
- Reports and analytics.
- Maintenance and complaint management.
- Enhanced notification system.

## 🎯 Project Goal

The goal of HostelHub is to digitize traditional hostel operations, reduce manual administrative work, improve transparency, and provide students and administrators with a centralized platform.

## 👨‍💻 Author

**Amit Kumar**

B.Tech Computer Science & Engineering  
Chandigarh University

## 📄 License

This project is developed for educational and learning purposes. Add an appropriate open-source license before allowing reuse or redistribution.
